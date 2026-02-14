# Demo → Production Checklist

## CRITICAL: Must change before any real patient data

### Security
- [ ] Generate new JWT_SECRET (minimum 64 random characters): `openssl rand -hex 64`
- [ ] Change all default passwords (database, admin user)
- [ ] Set DB_PASSWORD to a strong random value
- [ ] Set BACKUP_ENCRYPTION_KEY to a strong passphrase (store securely)
- [ ] Enable full disk encryption on server (LUKS on Linux)
- [ ] Configure firewall: only allow ports 443 (HTTPS) and SSH from admin IPs
- [ ] Set IP_ALLOWLIST to clinic LAN subnet (e.g., 192.168.1.0/24)
- [ ] Run `scripts/setup-local-ca.sh` and install CA cert on all client devices
- [ ] Enable MFA for all admin/owner accounts
- [ ] Remove demo seed data: `DROP DATABASE fvpt_emr; CREATE DATABASE fvpt_emr;` then run migrations
- [ ] Review and restrict ALLOWED_ORIGINS

### Database
- [ ] Change PostgreSQL password from default
- [ ] Enable PostgreSQL SSL connections
- [ ] Configure pg_hba.conf to reject non-local connections
- [ ] Enable WAL archiving for point-in-time recovery
- [ ] Set up automated backup schedule (cron)
- [ ] Test restore procedure with backup script

### Application
- [ ] Set NODE_ENV=production
- [ ] Set TRUST_PROXY=true (behind Caddy)
- [ ] Review rate limiting settings for clinic size
- [ ] Configure session timeouts per clinic policy
- [ ] Set up monitoring (server health, disk space, backup status)
- [ ] Remove or restrict /api/health endpoint details in production

### Network
- [ ] Configure router to assign static IP to EMR server
- [ ] Set up DNS entry for emr.local on clinic DNS/router
- [ ] Disable Caddy auto-HTTPS if using custom CA certificates
- [ ] If remote access needed: set up WireGuard VPN (see vpn-guide.md)
- [ ] NEVER expose ports 80/443/3001/5432 to the internet

### Clearinghouse Integration
- [ ] Implement production ClearinghouseAdapter for chosen vendor
- [ ] Configure API credentials (stored in env vars, not code)
- [ ] Test with sandbox/test mode before live claims
- [ ] Available adapters to implement: Office Ally, Availity, Optum

### Transcription
- [ ] If cloud transcription desired: sign BAA with provider
- [ ] Implement AWSTranscribeMedicalProvider (or similar)
- [ ] Configure audio storage policy (retain/delete)

### Compliance
- [ ] Engage HIPAA compliance consultant
- [ ] Complete Security Risk Assessment
- [ ] Draft policies: Privacy, Security, Breach Notification
- [ ] Sign BAAs with all business associates
- [ ] Train staff on HIPAA requirements
- [ ] Establish incident response procedure
- [ ] Set up breach notification process

### Hardware
- [ ] UPS (uninterruptible power supply) for server
- [ ] RAID or redundant storage
- [ ] Offsite backup rotation (weekly encrypted drive swap)
- [ ] Physical security for server (locked room/closet)

### Testing
- [ ] Run full test suite: `npm test`
- [ ] Run integration tests: `npm run test:integration`
- [ ] Verify all RBAC permissions work correctly
- [ ] Test backup and restore procedure
- [ ] Load test with expected concurrent users
- [ ] Penetration test (recommended)
