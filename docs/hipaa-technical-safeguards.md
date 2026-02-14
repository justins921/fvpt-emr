# HIPAA Technical Safeguard Mapping

> **DISCLAIMER**: This document maps technical controls to HIPAA requirements for reference only.
> It does NOT constitute legal compliance. Consult a qualified compliance professional.

## Access Control (§ 164.312(a)(1))

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| Unique User Identification | UUID per user, email as login | ✅ Implemented |
| Emergency Access Procedure | Admin can bypass via database | 📋 Documented |
| Automatic Logoff | 15-min idle timeout, 12-hr absolute | ✅ Implemented |
| Encryption and Decryption | HTTPS (TLS), bcrypt passwords, encrypted backups | ✅ Implemented |

## Audit Controls (§ 164.312(b))

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| Hardware/software activity recording | Append-only audit_events table | ✅ Implemented |
| PHI access logging | Chart opens, note views, exports logged | ✅ Implemented |
| Log integrity | Append-only table, no UPDATE/DELETE in app | ✅ Implemented |
| Log review | Admin audit viewer with filtering | ✅ Implemented |

## Integrity (§ 164.312(c)(1))

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| ePHI integrity mechanism | Signed notes are locked, amendments create versions | ✅ Implemented |
| Authentication of ePHI | JWT with session validation | ✅ Implemented |

## Person or Entity Authentication (§ 164.312(d))

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| Identity verification | Email + password + MFA-ready | ✅ Implemented (MFA stub) |
| Session management | Short-lived tokens, refresh rotation | ✅ Implemented |

## Transmission Security (§ 164.312(e)(1))

| Requirement | Implementation | Status |
|-------------|---------------|--------|
| Integrity controls | HTTPS required for all connections | ✅ Implemented |
| Encryption | TLS via Caddy reverse proxy | ✅ Implemented |

## Additional Technical Controls

| Control | Implementation | Status |
|---------|---------------|--------|
| RBAC / Least Privilege | 6 roles with specific permissions | ✅ Implemented |
| Tenant Isolation | clinic_id on all queries | ✅ Implemented |
| Backup Encryption | AES-256-CBC with passphrase | ✅ Implemented |
| Input Validation | Zod schemas on all endpoints | ✅ Implemented |
| Rate Limiting | Login: 10/15min, API: 200/min | ✅ Implemented |
| PHI Log Sanitization | PHI fields stripped from audit details | ✅ Implemented |
| Session Revocation | Per-session and per-user revoke | ✅ Implemented |
| Password Storage | bcrypt, 12 rounds | ✅ Implemented |
| File Upload Controls | MIME whitelist, size limits, scan hook | ✅ Implemented |
