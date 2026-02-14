# Backup & Restore Procedures

## Automated Backups

### Setup Nightly Backups

1. Set encryption key:
   ```bash
   export BACKUP_ENCRYPTION_KEY="your-secure-passphrase-here"
   ```

2. Add to crontab:
   ```bash
   crontab -e
   # Add:
   0 2 * * * BACKUP_ENCRYPTION_KEY="your-passphrase" /path/to/fvpt-emr/scripts/backup.sh /path/to/backups >> /var/log/fvpt-backup.log 2>&1
   ```

3. Backups are stored with 30-day retention by default.

### What Gets Backed Up
- Full PostgreSQL database dump (all tables including audit log)
- All uploaded attachments (PDFs, images)
- Both encrypted with AES-256-CBC

### What Does NOT Get Backed Up
- Application code (stored in version control)
- Docker images (rebuilt from Dockerfile)
- Environment variables (document separately)

## Manual Backup

```bash
export BACKUP_ENCRYPTION_KEY="your-passphrase"
./scripts/backup.sh ./backups
```

## Restore Procedure

### Full Restore

```bash
export BACKUP_ENCRYPTION_KEY="your-passphrase"
./scripts/restore.sh ./backups/db_backup_20240101_020000.sql.enc ./backups/attachments_20240101_020000.tar.enc
docker compose restart server
```

### Database-Only Restore

```bash
export BACKUP_ENCRYPTION_KEY="your-passphrase"
./scripts/restore.sh ./backups/db_backup_20240101_020000.sql.enc
docker compose restart server
```

## Disaster Recovery Runbook

### Scenario: Server Hardware Failure

1. Provision new server with same OS
2. Install Docker and Docker Compose
3. Clone repository or copy application files
4. Copy most recent encrypted backup files from offsite storage
5. Run `docker compose up -d db` (start database first)
6. Wait for database to be healthy
7. Run restore script with backup files
8. Run `docker compose up -d` (start all services)
9. Verify application is accessible
10. Verify data integrity (spot-check patient records)
11. Update DNS/network configuration if server IP changed

### Scenario: Database Corruption

1. Stop the server: `docker compose stop server`
2. Restore from last known good backup
3. Restart: `docker compose start server`
4. Review audit log for any data entered since backup

### Recommended Hardware

- UPS (minimum 30 minutes runtime) to allow graceful shutdown
- RAID 1 (mirrored) storage for OS and database
- Separate backup drive (rotated offsite weekly)
