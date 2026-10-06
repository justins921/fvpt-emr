#!/usr/bin/env bash
set -euo pipefail

# FVPT-EMR Tiered Backup Script
# Performs encrypted backups of PostgreSQL database and attachments
# with tiered retention: 7 daily, 4 weekly (Sunday), 12 monthly (1st).
#
# The tier is detected automatically from the current date:
#   - 1st of the month  -> monthly tier
#   - Sunday            -> weekly tier
#   - any other day     -> nightly tier
#
# Run this from a single daily cron job; the script picks the right tier.
#
# Usage: ./scripts/backup-tiered.sh [backup_dir]
#
# Required env: BACKUP_ENCRYPTION_KEY (passphrase for AES-256-CBC encryption)

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_CONTAINER="fvpt-emr-db"
UPLOADS_VOLUME="fvpt-emr_uploads"
ENCRYPTION_PASSPHRASE="${BACKUP_ENCRYPTION_KEY:-}"

# Retention counts per tier
KEEP_NIGHTLY=7
KEEP_WEEKLY=4
KEEP_MONTHLY=12

if [ -z "$ENCRYPTION_PASSPHRASE" ]; then
  echo "ERROR: BACKUP_ENCRYPTION_KEY is not set. Refusing to create unencrypted PHI backups."
  exit 1
fi

# ── Tier detection ──────────────────────────────────────────────────
DAY_OF_MONTH=$(date +%d)
DAY_OF_WEEK=$(date +%u)  # 1=Monday ... 7=Sunday

if [ "$DAY_OF_MONTH" = "01" ]; then
  TIER="monthly"
  KEEP="$KEEP_MONTHLY"
elif [ "$DAY_OF_WEEK" = "7" ]; then
  TIER="weekly"
  KEEP="$KEEP_WEEKLY"
else
  TIER="nightly"
  KEEP="$KEEP_NIGHTLY"
fi

mkdir -p "$BACKUP_DIR"

echo "=== FVPT-EMR Backup ($TIER tier) - $TIMESTAMP ==="

encrypt_file() {
  local src="$1"
  openssl enc -aes-256-cbc -salt -pbkdf2 -in "$src" -out "${src}.enc" -pass "pass:${ENCRYPTION_PASSPHRASE}"
  rm "$src"
  echo "${src}.enc"
}

# ── 1. Database backup ──────────────────────────────────────────────
echo "[1/3] Backing up PostgreSQL database ($TIER)..."
DB_BACKUP_FILE="$BACKUP_DIR/db_backup_${TIER}_${TIMESTAMP}.sql"
docker exec "$DB_CONTAINER" pg_dump -U emr -d fvpt_emr --no-owner --no-privileges > "$DB_BACKUP_FILE"
DB_BACKUP_FILE=$(encrypt_file "$DB_BACKUP_FILE")
echo "  Database backup: $DB_BACKUP_FILE ($(du -h "$DB_BACKUP_FILE" | cut -f1))"

# ── 2. Attachments backup ───────────────────────────────────────────
echo "[2/3] Backing up attachments ($TIER)..."
ATTACH_BACKUP_FILE="$BACKUP_DIR/attachments_${TIER}_${TIMESTAMP}.tar"
if docker volume inspect "$UPLOADS_VOLUME" > /dev/null 2>&1; then
  docker run --rm -v "${UPLOADS_VOLUME}:/data" -v "$(cd "$BACKUP_DIR" && pwd)":/backup alpine \
    tar cf "/backup/attachments_${TIER}_${TIMESTAMP}.tar" -C /data .
  ATTACH_BACKUP_FILE=$(encrypt_file "$ATTACH_BACKUP_FILE")
  echo "  Attachments backup: $ATTACH_BACKUP_FILE ($(du -h "$ATTACH_BACKUP_FILE" | cut -f1))"
else
  echo "  No uploads volume found, skipping attachments"
  ATTACH_BACKUP_FILE=""
fi

# ── 3. Tiered retention pruning ───────────────────────────────────────
echo "[3/3] Pruning old backups (keep $KEEP per tier)..."

prune_tier() {
  local pattern="$1"
  local keep="$2"
  local label="$3"
  # List newest-first by modification time, skip the $keep newest, delete the rest
  local count=0
  while IFS= read -r file; do
    count=$((count + 1))
    if [ "$count" -gt "$keep" ]; then
      echo "  Pruning old $label backup: $(basename "$file")"
      rm -f "$file"
    fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -name "$pattern" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
}

prune_tier "db_backup_nightly_*"   "$KEEP_NIGHTLY"  "nightly db"
prune_tier "db_backup_weekly_*"    "$KEEP_WEEKLY"   "weekly db"
prune_tier "db_backup_monthly_*"   "$KEEP_MONTHLY"  "monthly db"
prune_tier "attachments_nightly_*" "$KEEP_NIGHTLY"  "nightly attachments"
prune_tier "attachments_weekly_*"  "$KEEP_WEEKLY"   "weekly attachments"
prune_tier "attachments_monthly_*" "$KEEP_MONTHLY"  "monthly attachments"

# Legacy untiered files from the old backup.sh (db_backup_YYYYMMDD_*):
# treat as nightly tier so they age out naturally.
prune_tier "db_backup_20*"      "$KEEP_NIGHTLY" "legacy db"
prune_tier "attachments_20*"    "$KEEP_NIGHTLY" "legacy attachments"

echo ""
echo "=== Backup Complete ($TIER tier) ==="
echo "Files stored in: $BACKUP_DIR"
echo ""
echo "IMPORTANT: Copy backups to a separate physical device or offsite location."
echo "Test restores quarterly with scripts/restore.sh."
