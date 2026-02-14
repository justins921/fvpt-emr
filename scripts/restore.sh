#!/usr/bin/env bash
set -euo pipefail

# FVPT-EMR Restore Script
# Restores from encrypted backups
# Usage: ./scripts/restore.sh <db_backup_file> [attachments_backup_file]

if [ $# -lt 1 ]; then
  echo "Usage: $0 <db_backup_file> [attachments_backup_file]"
  echo "Example: $0 ./backups/db_backup_20240101_120000.sql.enc"
  exit 1
fi

DB_BACKUP="$1"
ATTACH_BACKUP="${2:-}"
DB_CONTAINER="fvpt-emr-db"
ENCRYPTION_PASSPHRASE="${BACKUP_ENCRYPTION_KEY:-}"

echo "=== FVPT-EMR Restore ==="
echo "WARNING: This will REPLACE all current data!"
read -p "Are you sure? (type 'yes' to continue): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

# 1. Restore database
echo "[1/2] Restoring database from: $DB_BACKUP"
DB_FILE="$DB_BACKUP"

if [[ "$DB_BACKUP" == *.enc ]]; then
  if [ -z "$ENCRYPTION_PASSPHRASE" ]; then
    echo "ERROR: Encrypted backup detected but BACKUP_ENCRYPTION_KEY not set"
    exit 1
  fi
  echo "  Decrypting..."
  DB_FILE="/tmp/fvpt_restore_$$.sql"
  openssl enc -aes-256-cbc -d -pbkdf2 -in "$DB_BACKUP" -out "$DB_FILE" -pass "pass:${ENCRYPTION_PASSPHRASE}"
fi

echo "  Dropping and recreating database..."
docker exec "$DB_CONTAINER" psql -U emr -d postgres -c "DROP DATABASE IF EXISTS fvpt_emr;"
docker exec "$DB_CONTAINER" psql -U emr -d postgres -c "CREATE DATABASE fvpt_emr;"

echo "  Loading backup..."
docker exec -i "$DB_CONTAINER" psql -U emr -d fvpt_emr < "$DB_FILE"

if [[ "$DB_BACKUP" == *.enc ]]; then
  rm -f "$DB_FILE"
fi
echo "  Database restored."

# 2. Restore attachments
if [ -n "$ATTACH_BACKUP" ]; then
  echo "[2/2] Restoring attachments from: $ATTACH_BACKUP"
  ATTACH_FILE="$ATTACH_BACKUP"
  
  if [[ "$ATTACH_BACKUP" == *.enc ]]; then
    if [ -z "$ENCRYPTION_PASSPHRASE" ]; then
      echo "ERROR: Encrypted backup detected but BACKUP_ENCRYPTION_KEY not set"
      exit 1
    fi
    ATTACH_FILE="/tmp/fvpt_attach_$$.tar"
    openssl enc -aes-256-cbc -d -pbkdf2 -in "$ATTACH_BACKUP" -out "$ATTACH_FILE" -pass "pass:${ENCRYPTION_PASSPHRASE}"
  fi
  
  docker run --rm -v fvpt-emr_uploads:/data -v "$(dirname "$(realpath "$ATTACH_FILE")")":/backup alpine \
    sh -c "rm -rf /data/* && tar xf /backup/$(basename "$ATTACH_FILE") -C /data"
  
  if [[ "$ATTACH_BACKUP" == *.enc ]]; then
    rm -f "$ATTACH_FILE"
  fi
  echo "  Attachments restored."
else
  echo "[2/2] No attachments backup specified, skipping."
fi

echo ""
echo "=== Restore Complete ==="
echo "Restart the application: docker compose restart server"
