# FVPT-EMR Threat Model & Data Flow

## System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Clinic LAN (Private)                    │
│                                                            │
│  ┌─────────┐    HTTPS     ┌──────────┐    ┌────────────┐ │
│  │  iPad /  │◄───────────►│  Caddy   │    │  Postgres  │ │
│  │  Laptop  │             │ (Reverse │    │  Database   │ │
│  │  Desktop │             │  Proxy)  │    │  (encrypted │ │
│  └─────────┘              │  :443    │    │   at rest)  │ │
│                           └────┬─────┘    └──────┬─────┘ │
│                                │                  │       │
│                           ┌────┴─────┐           │       │
│                           │  Express │◄──────────┘       │
│                           │  API     │                    │
│                           │  :3001   │    ┌────────────┐ │
│                           │          │───►│  File Store │ │
│                           └──────────┘    │  (uploads/) │ │
│                                           └────────────┘ │
└──────────────────────────────────────────────────────────┘
         │ (optional, via VPN only)
         ▼
    ┌──────────┐
    │ Remote   │
    │ Access   │
    │ (VPN)    │
    └──────────┘
```

## Data Classification

| Data Type | Classification | Storage | Encryption |
|-----------|---------------|---------|------------|
| Patient demographics | PHI | Database | TLS in-transit, disk encryption at-rest |
| Clinical notes (SOAP) | PHI | Database | TLS in-transit, disk encryption at-rest |
| Insurance/billing | PHI + Financial | Database | TLS in-transit, disk encryption at-rest |
| Attachments (PDFs/images) | PHI | File system | TLS in-transit, optionally encrypted files |
| Audit logs | Operational | Database | Contains no PHI (sanitized) |
| User credentials | Security | Database | bcrypt hashed (12 rounds) |
| Session tokens | Security | Database | SHA-256 hashed |
| JWT secrets | Security | Environment | Not stored in DB or logs |

## Threat Analysis

### T1: Unauthorized Network Access
- **Risk**: Attacker on same network accesses EMR
- **Mitigations**: HTTPS required, IP allowlist, authentication required for all endpoints
- **Residual**: LAN security depends on clinic network configuration

### T2: Credential Theft
- **Risk**: Stolen or guessed passwords
- **Mitigations**: bcrypt (12 rounds), rate limiting (10 attempts/15min), session idle timeout (15min), MFA-ready architecture
- **Residual**: Password quality depends on admin enforcement

### T3: Session Hijacking
- **Risk**: Stolen JWT/refresh token
- **Mitigations**: Short-lived JWTs (15min), refresh token rotation, session binding to IP, revocation support
- **Residual**: XSS could expose tokens (mitigated by CSP headers)

### T4: PHI Leakage in Logs
- **Risk**: PHI appearing in server logs or error traces
- **Mitigations**: Audit log sanitization strips PHI fields, error handler returns generic messages in production, no PHI in console output
- **Residual**: Developer error could introduce logging of PHI

### T5: SQL Injection
- **Risk**: Malicious input in database queries
- **Mitigations**: Parameterized queries throughout, Zod input validation, no string concatenation in SQL
- **Residual**: Standard parameterized query protections

### T6: Cross-Tenant Data Leak
- **Risk**: One clinic accessing another clinic's data
- **Mitigations**: clinic_id enforced on all queries via tenant scope middleware, database constraints
- **Residual**: Single database instance (multi-tenant isolation at query level, not database level)

### T7: Malicious File Upload
- **Risk**: Uploaded files containing malware
- **Mitigations**: MIME type whitelist, file size limits, malware scan hook interface (stub), Content-Disposition headers prevent browser execution
- **Residual**: No active malware scanning in demo mode

### T8: Physical Server Theft
- **Risk**: Server hardware stolen from clinic
- **Mitigations**: Encrypted backups, disk encryption guidance, database password protection
- **Residual**: Full disk encryption must be configured at OS level

### T9: Insider Threat
- **Risk**: Authorized user accessing unauthorized records
- **Mitigations**: RBAC with least privilege, immutable audit log, chart open logging
- **Residual**: Authorized users can access within their permission scope

### T10: Backup Compromise
- **Risk**: Unencrypted backups stolen
- **Mitigations**: AES-256-CBC encrypted backups, passphrase-protected
- **Residual**: Passphrase management is clinic responsibility

## Data Flow: Patient Visit

1. Front desk checks in patient → `appointment.status = 'checked_in'` → Audit logged
2. Therapist opens chart → Audit: `chart.open` → Starts note
3. Therapist dictates → Audio sent to transcription provider → Text returned (no audio stored by default)
4. Therapist completes SOAP → Draft saved → Autosave on changes
5. Therapist signs note → `note.status = 'final'` → Audit: `note.sign` → Locked
6. Biller creates claim from note → Charge capture → Ledger entries created → Audit logged
7. Biller scrubs claim → Validation errors returned
8. Biller exports 837P → File downloaded → Manual upload to clearinghouse
9. ERA received → Imported → Auto-posted to ledger → Claim status updated
