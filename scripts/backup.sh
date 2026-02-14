#!/usr/bin/env bash
set -euo pipefail

# FVPT-EMR Backup Script
# Performs encrypted backups of PostgreSQL database and attachments
# Usage: ./scripts/backup.sh [backup_dir]

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_CONTAINER="fvpt-emr-db"
RETENTION_DAYS=30
ENCRYPTION_PASSPHRASE="${BACKUP_ENCRYPTION_KEY:-}"

mkdir -p "$BACKUP_DIR"

echo "=== FVPT-EMR Backup - $TIMESTAMP ==="

# 1. Database backup
echo "[1/3] Backing up PostgreSQL database..."
DB_BACKUP_FILE="$BACKUP_DIR/db_backup_${TIMESTAMP}.sql"
docker exec "$DB_CONTAINER" pg_dump -U emr -d fvpt_emr --no-owner --no-privileges > "$DB_BACKUP_FILE"

if [ -n "$ENCRYPTION_PASSPHRASE" ]; then
  echo "  Encrypting database backup..."
  openssl enc -aes-256-cbc -salt -pbkdf2 -in "$DB_BACKUP_FILE" -out "${DB_BACKUP_FILE}.enc" -pass "pass:${ENCRYPTION_PASSPHRASE}"
  rm "$DB_BACKUP_FILE"
  DB_BACKUP_FILE="${DB_BACKUP_FILE}.enc"
fi
echo "  Database backup: $DB_BACKUP_FILE ($(du -h "$DB_BACKUP_FILE" | cut -f1))"

# 2. Attachments backup
echo "[2/3] Backing up attachments..."
ATTACH_BACKUP_FILE="$BACKUP_DIR/attachments_${TIMESTAMP}.tar"
if docker volume inspect fvpt-emr_uploads > /dev/null 2>&1; then
  docker run --rm -v fvpt-emr_uploads:/data -v "$(cd "$BACKUP_DIR" && pwd)":/backup alpine \
    tar cf "/backup/attachments_${TIMESTAMP}.tar" -C /data .
  
  if [ -n "$ENCRYPTION_PASSPHRASE" ]; then
    echo "  Encrypting attachments backup..."
    openssl enc -aes-256-cbc -salt -pbkdf2 -in "$ATTACH_BACKUP_FILE" -out "${ATTACH_BACKUP_FILE}.enc" -pass "pass:${ENCRYPTION_PASSPHRASE}"
    rm "$ATTACH_BACKUP_FILE"
    ATTACH_BACKUP_FILE="${ATTACH_BACKUP_FILE}.enc"
  fi
  echo "  Attachments backup: $ATTACH_BACKUP_FILE ($(du -h "$ATTACH_BACKUP_FILE" | cut -f1))"
else
  echo "  No uploads volume found, skipping attachments"
fi

# 3. Cleanup old backups
echo "[3/3] Cleaning up backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "db_backup_*" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "attachments_*" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

echo ""
echo "=== Backup Complete ==="
echo "Files stored in: $BACKUP_DIR"
echo ""
echo "IMPORTANT: Store backups on a separate physical device or offsite location."
echo "Consider rotating encrypted drives weekly for disaster recovery."
