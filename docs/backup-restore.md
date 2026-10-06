# Backup & Restore Procedures

## Tiered Backup Schedule

Backups run from a **single daily cron job**. `scripts/backup-tiered.sh` detects
the tier automatically from the date:

| Tier    | When              | Retention       |
|---------|-------------------|-----------------|
| Nightly | Every day         | Last 7 backups  |
| Weekly  | Sundays           | Last 4 backups  |
| Monthly | 1st of the month  | Last 12 backups |

If the 1st falls on a Sunday, it counts as a monthly backup.

Total worst-case storage: ~23 full backup sets (7 + 4 + 12).

### Setup

1. Generate an encryption key and store it somewhere safe (password manager).
   Backups are **always encrypted** — the script refuses to run without it:
   ```bash
   openssl rand -base64 48
   ```

2. Add one cron entry (runs daily at 2 AM, script picks the tier):
   ```bash
   crontab -e
   # Add:
   0 2 * * * BACKUP_ENCRYPTION_KEY="your-passphrase" /path/to/fvpt-emr/scripts/backup-tiered.sh /path/to/backups >> /var/log/fvpt-backup.log 2>&1
   ```

3. Verify the first run:
   ```bash
   ls -lh /path/to/backups/
   # Should show db_backup_nightly_YYYYMMDD_HHMMSS.sql.enc
   # and attachments_nightly_YYYYMMDD_HHMMSS.tar.enc
   ```

### What Gets Backed Up
- Full PostgreSQL database dump (all tables including audit log)
- All uploaded attachments (PDFs, images, encrypted PHI files)
- Both encrypted with AES-256-CBC (PBKDF2 key derivation)

### What Does NOT Get Backed Up
- Application code (stored in version control)
- Docker images (rebuilt from Dockerfile)
- Environment variables (document separately — see on-site-deployment.md)
- Caddy TLS certificates (auto-renewed by Caddy)

### Offsite Copies

The tiered script only manages local retention. For disaster recovery,
copy backups offsite:

```bash
# Example: nightly sync to a NAS or rotated USB drive
0 4 * * * rsync -a --delete /path/to/backups/ /mnt/backup-drive/fvpt-emr/
```

At minimum, rotate an encrypted USB drive offsite weekly.

## Manual Backup

```bash
export BACKUP_ENCRYPTION_KEY="your-passphrase"
./scripts/backup-tiered.sh ./backups
```

## Restore Procedure

`scripts/restore.sh` works with any tier — just point it at the files you want:

### Full Restore

```bash
export BACKUP_ENCRYPTION_KEY="your-passphrase"
./scripts/restore.sh ./backups/db_backup_monthly_20261001_020000.sql.enc ./backups/attachments_monthly_20261001_020000.tar.enc
docker compose restart server
```

### Database-Only Restore

```bash
export BACKUP_ENCRYPTION_KEY="your-passphrase"
./scripts/restore.sh ./backups/db_backup_weekly_20261004_020000.sql.enc
docker compose restart server
```

### Which Backup to Restore?

- **Oops, deleted something today** → latest nightly
- **Data corruption noticed this week** → latest weekly
- **Need a point from months ago** (audit, legal) → monthly

## Disaster Recovery Runbook

### Scenario: Server Hardware Failure

1. Provision new server with same OS
2. Install Docker and Docker Compose
3. Clone repository or copy application files
4. Copy most recent encrypted backup files from offsite storage
5. Create `.env` with your secrets (see docs/on-site-deployment.md)
6. Run `docker compose up -d db` (start database first)
7. Wait for database to be healthy: `docker compose ps`
8. Run restore script with backup files
9. Run `docker compose up -d` (start all services)
10. Verify application is accessible
11. Verify data integrity (spot-check patient records)
12. Update DNS/network configuration if server IP changed

### Scenario: Database Corruption

1. Stop the server: `docker compose stop server`
2. Restore from last known good backup (try nightly first, then weekly)
3. Restart: `docker compose start server`
4. Review audit log for any data entered since backup

### Scenario: Ransomware / Full Compromise

1. Do NOT pay. Isolate the server from the network.
2. Provision a clean server.
3. Restore from the most recent **offsite** backup (local backups may be compromised).
4. Rotate ALL secrets: JWT_SECRET, PHI_ENCRYPTION_KEY, DB_PASSWORD, BACKUP_ENCRYPTION_KEY.
5. Review the incident-response plan in docs/incident-response-plan.md.

## Recommended Hardware

- UPS (minimum 30 minutes runtime) to allow graceful shutdown
- RAID 1 (mirrored) storage for OS and database
- Separate backup drive (rotated offsite weekly)

## Testing Your Backups

Untested backups are not backups. Quarterly:

1. Spin up a temporary server or VM
2. Restore your latest monthly backup
3. Log in and spot-check records
4. Document the test date

If a restore ever fails, fix the process immediately — don't wait for a real disaster.
