# FVPT-EMR: Physical Therapy EMR System

Physical Therapy Electronic Medical Records + Scheduling + Billing system.
Deploy on **Vercel** (demo/remote access) or **local Docker** (on-premises production).

## Architecture

- **Backend**: Express.js + TypeScript + PostgreSQL (Vercel serverless or standalone)
- **Frontend**: React + TypeScript + Vite + Tailwind CSS (PWA-ready)
- **Deployment**: Vercel (cloud) or Docker Compose with Caddy (on-prem)
- **Database**: Vercel Postgres / Neon (cloud) or local PostgreSQL (on-prem)
- **Security**: RBAC, audit logging, encrypted backups, PHI-safe logging

---

## Deploy on Vercel (Recommended for Demo)

### 1. Create Vercel Postgres Database

1. Go to your Vercel project dashboard
2. Storage tab > Create Database > Postgres
3. This auto-sets `POSTGRES_URL` in your environment

### 2. Set Environment Variables

In Vercel dashboard > Settings > Environment Variables:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | *(auto-set by Vercel Postgres)* |
| `JWT_SECRET` | `openssl rand -hex 64` |
| `NODE_ENV` | `production` |

### 3. Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Run migrations against Vercel Postgres
vercel env pull .env.local
DATABASE_URL="your-neon-connection-string" npm run migrate

# Seed demo data
DATABASE_URL="your-neon-connection-string" npm run seed
```

### 4. Access

Your app is live at `https://your-project.vercel.app`.
Login: `admin@clinic.local` / `password123!`

---

## Quick Start (Local Development)

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

## Switching Between Vercel and Local

The same codebase works in both environments:

| | Vercel (Cloud) | Docker (On-Prem) |
|--|----------------|-------------------|
| **API** | Serverless function (`api/index.ts`) | Express server (`server/src/index.ts`) |
| **Database** | Vercel Postgres (Neon) | Local PostgreSQL container |
| **Files** | Ephemeral `/tmp` (add Vercel Blob for persistence) | Local disk `./uploads` |
| **HTTPS** | Automatic via Vercel | Caddy with local CA certs |
| **Access** | Public URL (restrict via auth) | LAN only (optional VPN) |

To move from Vercel demo to local production:
1. Set up a local server with Docker
2. Change `DATABASE_URL` to local Postgres
3. Run `docker compose up -d`
4. All your data schema and app code stays the same

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
