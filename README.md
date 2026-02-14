# FVPT-EMR: Physical Therapy EMR System

Local-first, on-premises Physical Therapy Electronic Medical Records + Scheduling + Billing system.

## Architecture

- **Backend**: Express.js + TypeScript + PostgreSQL
- **Frontend**: React + TypeScript + Vite + Tailwind CSS (PWA-ready)
- **Deployment**: Docker Compose with Caddy reverse proxy (HTTPS)
- **Security**: RBAC, audit logging, encrypted backups, PHI-safe logging

## Quick Start (Development)

```bash
# 1. Start PostgreSQL
docker compose up -d db

# 2. Install dependencies
npm install && cd server && npm install && cd ../client && npm install && cd ..

# 3. Run migrations
npm run migrate

# 4. Seed demo data
npm run seed

# 5. Start dev servers
npm run dev
```

Access at http://localhost:5173. Login: `admin@clinic.local` / `password123!`

## Docker Compose (Production-like)

```bash
# Build and start all services
docker compose up -d --build

# Run migrations
docker compose exec server node dist/migrations/runner.js up

# Access at https://emr.local (configure DNS)
```

## Demo Credentials

| Email | Role | Password |
|-------|------|----------|
| admin@clinic.local | Owner/Admin | password123! |
| therapist@clinic.local | Therapist | password123! |
| frontdesk@clinic.local | Front Desk | password123! |
| biller@clinic.local | Biller | password123! |
| readonly@clinic.local | Read Only | password123! |

## Project Structure

```
fvpt-emr/
├── server/src/
│   ├── middleware/     # Auth, RBAC, security middleware
│   ├── routes/         # API endpoints
│   ├── services/       # Business logic (auth, audit, claims)
│   ├── adapters/       # Clearinghouse, transcription adapters
│   ├── migrations/     # Database schema
│   ├── types/          # TypeScript types
│   └── index.ts        # Express server entry
├── client/src/
│   ├── components/     # Layout, shared components
│   ├── pages/          # Route pages
│   ├── hooks/          # Auth, idle timeout, shortcuts
│   ├── services/       # API client
│   └── styles/         # Tailwind CSS
├── docker/             # Dockerfiles, Caddy/Nginx config
├── scripts/            # Backup, restore, CA setup
├── docs/               # Threat model, HIPAA mapping, guides
└── docker-compose.yml
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both server and client in dev mode |
| `npm run build` | Build for production |
| `npm test` | Run unit tests |
| `npm run migrate` | Run database migrations |
| `npm run seed` | Seed demo data |
| `npm run backup` | Run encrypted backup |
| `npm run restore` | Restore from backup |
| `npm run docker:up` | Start via Docker Compose |

## Documentation

- [Threat Model & Data Flow](docs/threat-model.md)
- [HIPAA Technical Safeguards](docs/hipaa-technical-safeguards.md)
- [Production Checklist](docs/production-checklist.md)
- [VPN Remote Access Guide](docs/vpn-guide.md)
- [Backup & Restore](docs/backup-restore.md)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Alt+H | Dashboard |
| Alt+S | Schedule |
| Alt+P | Patients |
| Alt+B | Billing |
| Alt+A | Audit Log |
