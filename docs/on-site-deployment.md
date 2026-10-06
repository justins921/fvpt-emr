# On-Site Deployment Guide

Self-host FVPT-EMR on your clinic's own server instead of using the cloud-hosted
version. This guide assumes you're a competent IT person — you can use a Linux
terminal, install packages, and edit config files — but not necessarily a
DevOps engineer.

## Cloud vs. On-Site: Honest Tradeoffs

|                        | Cloud (Vercel + Neon)         | On-Site (this guide)              |
|------------------------|-------------------------------|-----------------------------------|
| Server hardware        | None needed                   | You buy and maintain it           |
| Uptime                 | Provider handles it           | You're on call                    |
| Security patches       | Automatic                     | You apply them                    |
| Backups                | Provider snapshots            | You configure (see below)         |
| Scaling                | Automatic                     | Manual (usually fine for 1 clinic)|
| Data location          | Provider's data centers       | Your server room                  |
| Internet required      | Always                        | Only for remote access            |
| Monthly cost           | Hosting fees                  | Electricity + your time           |

**Choose on-site if:** the clinic doesn't trust cloud storage for patient data,
wants the system to work during internet outages (LAN access), or already has
server infrastructure.

**Choose cloud if:** there's no IT person available for ongoing maintenance.
An unmaintained on-site server is worse than cloud in every way.

## Prerequisites

- A Linux server (Ubuntu 22.04 LTS or Debian 12 recommended)
  - Minimum: 2 CPU cores, 4 GB RAM, 50 GB SSD
  - Recommended: 4 cores, 8 GB RAM, 100 GB SSD (RAID 1)
- Docker and Docker Compose v2 ([install guide](https://docs.docker.com/engine/install/))
- Node.js 20+ (for running migrations and admin scripts from the repo)
- A hostname: either a public domain (e.g. `emr.yourclinic.com`) or a LAN
  name (e.g. `emr.local`). For LAN-only, clients need to resolve the name
  (local DNS or hosts file entries).
- Ports 80 and 443 reachable (for Let's Encrypt, if using a public domain)

## Step 1: Get the Code

```bash
# Install git if needed: sudo apt install git
git clone https://github.com/YOUR_ORG/fvpt-emr.git /opt/fvpt-emr
cd /opt/fvpt-emr
git checkout claude/pt-emr-local-system-aRb9K   # or your production branch
```

## Step 2: Configure Environment

Copy the example and fill in your secrets:

```bash
cp .env.example .env
nano .env
```

### Required variables

Generate secrets first — do NOT use the example values:

```bash
openssl rand -hex 64   # run twice, use once for each below
```

| Variable             | What it does                                              | Example                                          |
|----------------------|-----------------------------------------------------------|--------------------------------------------------|
| `DB_PASSWORD`        | Postgres password for the `emr` database user             | Random 32+ char string                           |
| `JWT_SECRET`         | Signs login session tokens (min 32 chars)                 | `openssl rand -hex 64` output                    |
| `PHI_ENCRYPTION_KEY` | Encrypts uploaded PHI files at rest (min 32 chars)        | `openssl rand -hex 64` output (different one)    |
| `DOMAIN`             | Hostname Caddy serves (used by docker/Caddyfile)          | `emr.yourclinic.com` or `emr.local`              |
| `TLS_MODE`           | Leave unset for LAN (self-signed); set empty for public domain (Let's Encrypt) | _(unset)_ or empty string       |
| `ALLOWED_ORIGINS`    | Which origins can call the API (must include your DOMAIN) | `https://emr.yourclinic.com`                     |

### Optional variables

| Variable             | What it does                                              | Default            |
|----------------------|-----------------------------------------------------------|--------------------|
| `LOG_LEVEL`          | Server log verbosity (`debug`, `info`, `warn`, `error`)   | `info`             |
| `MAX_FILE_SIZE_MB`   | Max attachment upload size                                | `25`               |
| `SESSION_IDLE_TIMEOUT_MINUTES` | Auto-logout after inactivity                   | `15`               |
| `BACKUP_ENCRYPTION_KEY` | Passphrase for backup encryption (set in cron, not .env) | _(none — required for backups)_ |

**Store a copy of `.env` somewhere safe** (password manager, sealed envelope).
If you lose `PHI_ENCRYPTION_KEY`, encrypted attachments are unrecoverable.
If you lose `JWT_SECRET`, everyone gets logged out (annoying, not fatal).

## Step 3: Start the Services

```bash
cd /opt/fvpt-emr
docker compose up -d
```

This starts four containers:
- `db` — PostgreSQL 16 (data in the `pgdata` Docker volume)
- `server` — API (port 3001, internal only)
- `client` — web app behind nginx (port 8080, internal only)
- `caddy` — reverse proxy with HTTPS (ports 80/443, this is what users hit)

Check everything is healthy:

```bash
docker compose ps
# All services should show "healthy" or "running"
docker compose logs --tail 20 server
```

**If compose refuses to start** complaining about `JWT_SECRET` or
`PHI_ENCRYPTION_KEY`: that's intentional. Set them in `.env` (Step 2) —
the app will not boot with missing or default secrets.

## Step 4: Run Database Migrations

```bash
cd /opt/fvpt-emr
npm install          # installs workspace dependencies (one time)
npm run migrate -w server
```

You should see each migration apply in order. If a migration fails, do not
run the app — resolve the error first.

## Step 5: Create Your Clinic and Admin User

Do NOT run `npm run seed` — that creates demo data with fake patients.
Use the admin script instead:

```bash
npm run create-admin -w server -- \
  --clinic "Fox Valley Physical Therapy" \
  --npi "1234567890" \
  --tax-id "12-3456789" \
  --address "100 Main St" \
  --city "Appleton" --state "WI" --zip "54911" \
  --phone "920-555-0100" \
  --username "admin" \
  --password "use-a-strong-password-here-min-12-chars" \
  --first-name "Jane" --last-name "Doe"
```

## Step 6: Verify It's Working

1. Open `https://your-domain` in a browser.
   - **Public domain:** you should get a valid Let's Encrypt certificate automatically (takes ~1 minute on first start).
   - **LAN (`emr.local`):** you'll get a browser warning about the self-signed certificate. This is expected — click through, or install the Caddy root CA on clinic machines (see below).
2. Log in with the admin credentials from Step 5.
3. Create a test patient and appointment, then delete them.
4. Check `https://your-domain/api/health` returns `{"status":"healthy"}`.

### Trusting the LAN Certificate (Optional)

For `emr.local` without browser warnings on every machine:

```bash
# On the server, get Caddy's root CA:
docker cp fvpt-emr-caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Install `caddy-root.crt` as a trusted root CA on each clinic workstation
(Windows: certmgr.msc → Trusted Root; macOS: Keychain Access). This is a
one-time setup per machine.

## Step 7: Set Up Backups

Backups use `scripts/backup-tiered.sh` — 7 daily, 4 weekly (Sunday),
12 monthly (1st). See docs/backup-restore.md for full details.

```bash
# One cron entry — the script detects the tier from the date:
crontab -e
# Add (replace the passphrase and paths):
0 2 * * * BACKUP_ENCRYPTION_KEY="your-backup-passphrase" /opt/fvpt-emr/scripts/backup-tiered.sh /var/backups/fvpt-emr >> /var/log/fvpt-backup.log 2>&1

# Offsite copy (example: USB drive or NAS mounted at /mnt/offsite):
0 4 * * * rsync -a /var/backups/fvpt-emr/ /mnt/offsite/fvpt-emr/
```

**Test a restore quarterly.** An untested backup is not a backup.
See docs/backup-restore.md for the restore procedure.

## Step 8: Firewall

Only ports 80 and 443 need to be reachable. Lock everything else down:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp        # SSH — restrict to your IP if possible
sudo ufw enable
```

Do NOT expose port 5432 (Postgres) or 3001 (API) to the network.
They're only for inter-container communication.

## Doing Updates

```bash
cd /opt/fvpt-emr

# 1. Back up first — always
BACKUP_ENCRYPTION_KEY="your-passphrase" ./scripts/backup-tiered.sh /var/backups/fvpt-emr

# 2. Pull and rebuild
git pull
docker compose build
npm run migrate -w server    # apply any new migrations

# 3. Restart
docker compose up -d

# 4. Verify
curl -k https://localhost/api/health
docker compose ps
```

If something breaks, roll back:

```bash
git stash                        # or: git checkout <previous-commit>
docker compose build
docker compose up -d
# If data is the problem, restore from the backup you took in step 1
```

Schedule updates for off-hours. Announce downtime to staff.

## Ongoing Maintenance Checklist

**Weekly:**
- [ ] Glance at backup logs (`/var/log/fvpt-backup.log`) — did last night's backup succeed?
- [ ] Check disk space (`df -h`) — database and backups grow over time

**Monthly:**
- [ ] Apply OS security updates: `sudo apt update && sudo apt upgrade`
- [ ] Update Docker images: `docker compose pull && docker compose up -d`
- [ ] Verify offsite backup copy exists and is recent

**Quarterly:**
- [ ] Test restore on a temporary machine (docs/backup-restore.md)
- [ ] Review user accounts — disable anyone who left
- [ ] Review the audit log for anomalies

**Yearly:**
- [ ] Review this entire guide — things change
- [ ] Renew your HIPAA risk assessment (required annually)

## Networking Notes

### LAN-Only Setup

If the clinic doesn't need remote access, skip the public domain entirely:
- Set `DOMAIN=emr.local` (or a name your local DNS resolves)
- Caddy serves a self-signed cert (`tls internal`)
- The server doesn't need internet access after initial Docker image pulls
- Staff access via `https://emr.local` on the clinic network

### Remote Access via VPN (Recommended over Public Exposure)

Instead of exposing the EMR to the internet, give remote staff VPN access
to the clinic network (WireGuard is simple and reliable). This keeps the
attack surface minimal — the EMR is never directly reachable from the
internet.

### Public Domain Setup

- Point your domain's A record at the server's public IP
- Set `DOMAIN=emr.yourclinic.com` and `TLS_MODE=` (empty) in `.env`
- Caddy obtains a Let's Encrypt certificate automatically
- Keep port 80 open — Let's Encrypt uses it for verification

## What You're Responsible For

On-site means you own the full stack. Be honest with the clinic about this:

1. **Uptime.** If the server dies at 2 AM, nobody fixes it but you. Get a UPS
   and monitoring (even a free Uptime Kuma instance).
2. **Security patches.** OS, Docker, and app updates are on you. Unpatched
   servers get compromised — this holds patient health data.
3. **Backups.** The tooling is provided, but you must verify they run and
   test restores. See docs/backup-restore.md.
4. **HIPAA.** On-site doesn't exempt you from HIPAA. You still need a risk
   assessment, BAAs with any vendors, access controls, and audit procedures.
   See docs/hipaa-technical-safeguards.md.
5. **Hardware.** Disks fail. Use RAID 1 minimum, replace drives proactively,
   and keep a spare.

If the clinic can't commit to these, the cloud option is the safer choice.
