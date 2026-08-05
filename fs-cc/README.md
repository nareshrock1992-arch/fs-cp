# FreeSWITCH Contact Center

A full-stack contact-center management system built around **FreeSWITCH mod_callcenter**.  
It provides a supervisor Admin UI, a live Agent Desktop, a Node.js backend API with ESL bridge, and a PostgreSQL data store.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Directory Structure](#directory-structure)
3. [Prerequisites](#prerequisites)
4. [Quick Start — Dev (non-Docker)](#quick-start--dev-non-docker)
5. [Environment Variables](#environment-variables)
6. [Backend](#backend)
7. [Admin Frontend](#admin-frontend)
8. [Agent Desktop](#agent-desktop)
9. [FreeSWITCH ESL Integration](#freeswitch-esl-integration)
10. [Database Migrations](#database-migrations)
11. [PM2 Development Workflow](#pm2-development-workflow)
12. [Build for Production](#build-for-production)
13. [Docker Deployment](#docker-deployment)
14. [Troubleshooting](#troubleshooting)
15. [Developer Onboarding Checklist](#developer-onboarding-checklist)

---

## Architecture Overview

```
Browser (:8000)          Browser (:8080)
Admin UI (React)         Agent Desktop (React)
        │                        │
        └──── HTTP + Socket.IO ──┘
                     │
         Backend API (:4000)   ← Node 20 / Express
                     │
          ┌──────────┴──────────┐
     PostgreSQL            FreeSWITCH ESL
      (:5432)                  (:8021)
```

| Component | Port | Technology |
|---|---|---|
| Backend API | 4000 | Node 20, Express, Socket.IO |
| Admin UI | 8000 (prod) / 5173 (dev) | React 18, Vite, Tailwind |
| Agent Desktop | 8080 | React 18, Vite, Tailwind |
| Database | 5432 | PostgreSQL 14 |
| FreeSWITCH ESL | 8021 | mod_callcenter |

**Key flows:**
- Admin logs in → JWT (`role: 'admin'`) → access to all `/api/*` routes
- Agent logs in with `agent_id + PIN` → JWT (`role: 'agent'`) → access to `/api/agent-desk/*`
- Backend maintains a persistent ESL connection; FreeSWITCH events flow → Socket.IO rooms
- Queue stats polled every 3 s; agent performance polled every 30 s; call events are push via socket

---

## Directory Structure

```
fs-cc/
├── backend/                  Node.js API + ESL bridge
│   ├── config/index.js       All config (CORS, ESL, DB, JWT)
│   ├── controllers/          Route handlers
│   │   ├── agentDeskController.js   Agent login, queues, calls, performance
│   │   ├── agentsController.js      Admin agent CRUD + PIN management
│   │   ├── queuesController.js      Admin queue CRUD
│   │   └── authController.js        Admin login / register
│   ├── db/
│   │   ├── pool.js           pg Pool singleton
│   │   ├── schema.sql        Base tables
│   │   ├── migrate_auth.sql          users + agent_history tables
│   │   ├── migrate_ivr.sql           IVR / dialplan tables
│   │   ├── migrate_reporting.sql     Reporting views
│   │   ├── migrate_cdr_views.sql     CDR views
│   │   ├── migrate_indexes.sql       Performance indexes
│   │   └── migrate_agent_auth.sql    pin_hash + no_answer_delay_time columns
│   ├── middleware/auth.js    requireAuth (admin) + requireAgentAuth (agent)
│   ├── routes/               Express routers
│   ├── services/
│   │   ├── eslService.js     FreeSWITCH ESL client
│   │   └── socketService.js  Socket.IO setup + ESL→socket bridge
│   ├── utils/
│   │   ├── asyncHandler.js   Async error wrapper
│   │   └── queueXml.js       callcenter.conf.xml generator
│   ├── server.js             Entry point
│   ├── Dockerfile
│   └── package.json
│
├── frontend/                 Admin UI (port 5173 dev / 8000 prod)
│   ├── src/
│   │   ├── api/client.js     Axios API client (admin JWT)
│   │   ├── api/socket.js     Socket.IO client
│   │   ├── components/       Shared UI: Panel, Modal, StatusLamp, form helpers
│   │   └── pages/            Dashboard, Agents, Queues, Reports, CDR
│   ├── tailwind.config.js    Dark-mode palette (class strategy)
│   ├── Dockerfile
│   └── nginx.conf
│
├── agent-desktop/            Agent Desktop (port 8080)
│   ├── src/
│   │   ├── api/client.js     fetch-based API client (agent JWT)
│   │   ├── api/socket.js     Socket.IO client
│   │   ├── hooks/
│   │   │   ├── useAgentAuth.js    localStorage JWT session
│   │   │   └── useTheme.js        Light/dark mode + localStorage persist
│   │   ├── components/
│   │   │   ├── EslBadge.jsx       FS connection indicator
│   │   │   ├── LiveCallPanel.jsx  Ringing / in-call banner with live timer
│   │   │   ├── PerformanceCard.jsx  Today's calls handled / AHT / status log
│   │   │   ├── QueueCard.jsx      Per-queue stats + agent availability
│   │   │   ├── StatusControls.jsx Available / On Break / Logged Out buttons
│   │   │   └── ThemeToggle.jsx    Sun/Moon icon button
│   │   └── pages/
│   │       ├── Login.jsx          Agent ID + PIN form
│   │       └── Dashboard.jsx      Main agent view
│   ├── tailwind.config.js    CSS-variable-based palette (light + dark)
│   ├── Dockerfile
│   └── nginx.conf
│
├── dialplan/                 FreeSWITCH XML dialplan snippets
├── docs/                     Additional documentation
├── .env.example              Environment template — copy to .env
├── docker-compose.yml        Production compose file
└── DEPLOYMENT.md             Full Docker build + deployment guide
```

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ | Backend + Vite builds |
| npm | 9+ | Bundled with Node 20 |
| PostgreSQL | 14+ | Local or Docker |
| FreeSWITCH | 1.10+ | With `mod_callcenter` loaded |
| Docker + Compose | Latest | Production deployment only |

---

## Quick Start — Dev (non-Docker)

### 1. Clone and configure

```bash
git clone <repo-url> fs-cc
cd fs-cc

# Backend config
cp backend/.env.example backend/.env    # if it exists, otherwise edit backend/.env
# Or copy root .env.example:
cp .env.example .env
```

### 2. Apply database migrations

Run these once against your local PostgreSQL:

```bash
psql -U your_user -d your_db -f backend/db/schema.sql
psql -U your_user -d your_db -f backend/db/migrate_auth.sql
psql -U your_user -d your_db -f backend/db/migrate_ivr.sql
psql -U your_user -d your_db -f backend/db/migrate_reporting.sql
psql -U your_user -d your_db -f backend/db/migrate_cdr_views.sql
psql -U your_user -d your_db -f backend/db/migrate_indexes.sql
psql -U your_user -d your_db -f backend/db/migrate_agent_auth.sql
```

### 3. Install dependencies

```bash
(cd backend       && npm install)
(cd frontend      && npm install)
(cd agent-desktop && npm install)
```

### 4. Start services

Open three terminals:

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Admin UI  (http://localhost:5173)
cd frontend && npm run dev

# Terminal 3 — Agent Desktop  (http://localhost:8080)
cd agent-desktop && npm run dev
```

### 5. Create first admin user

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"yourpassword"}'
```

### 6. Set an agent PIN (required for Agent Desktop login)

```bash
# Get admin JWT
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"yourpassword"}' | jq -r .token)

# Set PIN for an agent (agent_id must already exist in the agents table)
curl -X POST http://localhost:4000/api/agents/Agent_1001@default/set-pin \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"pin":"1234"}'
```

Alternatively, use the Admin UI at `http://localhost:5173` → **Agents** → click the key icon.

### 7. Agent Desktop login

Open `http://localhost:8080` and log in with:
- **Agent ID**: `Agent_1001@default` (the FreeSWITCH agent name)
- **PIN**: `1234`

---

## Environment Variables

Copy `.env.example` to `.env` and set the four starred values.

| Variable | Default | Description |
|---|---|---|
| `SERVER_IP` ★ | — | LAN IP browsers use to reach this server |
| `DB_PASSWORD` ★ | `changeme` | PostgreSQL password |
| `FS_ESL_HOST` ★ | `${SERVER_IP}` | FreeSWITCH host for ESL connection |
| `JWT_SECRET` ★ | — | 32+ random chars — keep secret |
| `PORT` | `4000` | Backend listen port |
| `CORS_ORIGIN` | auto | Comma-separated allowed origins |
| `DB_HOST` | `db` (Docker) / `localhost` (dev) | |
| `DB_PORT` | `5432` | |
| `DB_NAME` | `fs_cc` | |
| `DB_USER` | `fs_cc` | |
| `FS_ESL_PORT` | `8021` | |
| `FS_ESL_PASSWORD` | `ClueCon` | |
| `FS_ESL_RECONNECT_MS` | `3000` | |
| `BACKEND_PORT` | `4000` | Docker host port |
| `FRONTEND_PORT` | `8000` | Docker host port |
| `AGENT_DESKTOP_PORT` | `8080` | Docker host port |
| `FS_CONF_PATH` | (empty) | Optional: write callcenter.conf.xml here |

**Dev-only** (`backend/.env`):
```
DB_HOST=localhost
CORS_ORIGIN=http://localhost:5173,http://localhost:8080
```

---

## Backend

### Entry point: `backend/server.js`

Route mounting order is critical:

```
POST /api/auth/*           → public login/register
POST /api/agent-desk/login → public agent login
GET|POST /api/agent-desk/* → requireAgentAuth (role: 'agent')
GET|POST /api/*            → requireAuth (role: 'admin'|'supervisor')
```

### Key modules

| File | Purpose |
|---|---|
| `services/eslService.js` | Persistent ESL TCP connection; reconnects on drop |
| `services/socketService.js` | Bridges ESL events → Socket.IO rooms; handles agent auth rooms |
| `controllers/agentDeskController.js` | Agent login, status, queues+stats, calls, performance |
| `controllers/agentsController.js` | CRUD + `setAgentPin` |
| `utils/queueXml.js` | Generates callcenter.conf.xml from DB; optionally writes to FS |

### Health check

```
GET /api/health  →  { status: "ok", time: "..." }
```

---

## Admin Frontend

- **Port (dev)**: 5173
- **Port (prod)**: 8000 (via Nginx)
- **Auth**: Username + Password → `role: 'admin'` JWT stored in `localStorage`
- **Theme**: Dark navy (fixed, no toggle — matches the OmniAlert brand)

### Pages

| Page | Route | Description |
|---|---|---|
| Dashboard | `/` | Live queue tiles, call activity chart |
| Agents | `/agents` | CRUD, status, PIN management |
| Queues | `/queues` | CRUD, XML preview/export |
| Reports | `/reports` | Daily summary charts |
| CDR | `/cdr` | Call detail records |

---

## Agent Desktop

- **Port (dev)**: 8080
- **Port (prod)**: 8080 (via Nginx)
- **Auth**: `agent_id` + PIN → `role: 'agent'` JWT, 12h expiry, auto-restored from `localStorage`
- **Theme**: Light/dark toggle — persists per browser in `localStorage`; respects OS preference on first visit

### Theme system

All colours are CSS custom properties defined in `src/index.css`:

```css
:root   { /* light palette */ }
.dark   { /* dark palette  */ }
```

Tailwind's `darkMode: 'class'` is enabled. `useTheme()` toggles the `dark` class on `<html>` and persists the choice. No `dark:` class prefixes are needed in JSX — the CSS vars automatically shift.

### Dashboard sections

1. **Live Call Panel** — appears on ring/answer; auto-hides on hangup
2. **Status Controls** — Available / On Break / Logged Out; writes to FS + DB
3. **Performance Today** — Calls Handled, Missed, Avg Talk, Total Talk; +30 s refresh
4. **My Queues** — cards for each assigned queue; +3 s refresh

---

## FreeSWITCH ESL Integration

The backend maintains one persistent ESL TCP connection (`eslService.js`).

### Agent operations

| Operation | ESL command |
|---|---|
| Set status | `callcenter_config agent set status <agent_id> <status>` |
| Set state | `callcenter_config agent set state <agent_id> <state>` |
| Add agent | `callcenter_config agent add <agent_id> callback` |
| Delete agent | `callcenter_config agent del <agent_id>` |
| Add to queue | `callcenter_config tier add <queue_name> <agent_id> <level> <pos>` |

### Events listened

| Event | What it triggers |
|---|---|
| `callcenter::info` AGENT_STATUS_CHANGE | Updates agents table + emits `agent:status` |
| `callcenter::info` AGENT_STATE_CHANGE | Updates agents table + emits `agent:state` |
| `callcenter::info` MEMBERS_COUNT | Updates queue member counts |
| `callcenter::info` BRIDGE | Records call answer; emits `call:bridged` |
| `callcenter::info` BRIDGE_TERMINATED | Records call end; emits `call:bridge-end` |
| `CHANNEL_HANGUP` | Emits `channel:hangup` |

### Queue XML generation

The backend can generate and optionally push `callcenter.conf.xml`:

```bash
# Preview (GET returns XML, does not write to disk)
curl http://localhost:4000/api/queues/preview-xml -H "Authorization: Bearer $TOKEN"

# Write to FS conf dir and reload (requires FS_CONF_PATH in .env)
curl -X POST http://localhost:4000/api/queues/export-xml -H "Authorization: Bearer $TOKEN"
```

---

## Database Migrations

All migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`). Run them in order:

```bash
psql -U $DB_USER -d $DB_NAME -f backend/db/schema.sql              # 01
psql -U $DB_USER -d $DB_NAME -f backend/db/migrate_auth.sql        # 02
psql -U $DB_USER -d $DB_NAME -f backend/db/migrate_ivr.sql         # 03
psql -U $DB_USER -d $DB_NAME -f backend/db/migrate_reporting.sql   # 04
psql -U $DB_USER -d $DB_NAME -f backend/db/migrate_cdr_views.sql   # 05
psql -U $DB_USER -d $DB_NAME -f backend/db/migrate_indexes.sql     # 06
psql -U $DB_USER -d $DB_NAME -f backend/db/migrate_agent_auth.sql  # 07
```

In Docker, they are mounted to `/docker-entrypoint-initdb.d/` and run automatically on first DB init.

---

## PM2 Development Workflow

Install PM2 globally once:

```bash
npm install -g pm2
```

Create `ecosystem.config.cjs` at the repo root:

```js
module.exports = {
  apps: [
    {
      name: 'cc-backend',
      cwd:  './backend',
      script: 'server.js',
      watch: ['controllers', 'routes', 'services', 'utils', 'middleware'],
      ignore_watch: ['node_modules', 'logs'],
      env: { NODE_ENV: 'development' },
    },
    {
      name: 'cc-frontend',
      cwd: './frontend',
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
    },
    {
      name: 'cc-agent',
      cwd: './agent-desktop',
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
    },
  ],
};
```

```bash
pm2 start ecosystem.config.cjs   # Start all three
pm2 logs                          # Tail all logs
pm2 logs cc-backend               # Backend only
pm2 restart cc-backend            # Hot-restart backend
pm2 stop all                      # Stop everything
pm2 save && pm2 startup           # Auto-start on system boot
```

---

## Build for Production

Builds generate static files that are served by Nginx inside Docker.

```bash
# Admin UI
cd frontend
npm run build          # outputs dist/

# Agent Desktop
cd agent-desktop
npm run build          # outputs dist/
```

Both use `VITE_API_URL=/api` (relative). Nginx proxies `/api` and `/socket.io` to the backend container. No IP addresses are baked into the builds.

---

## Docker Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the complete build, export, transfer, and customer-site deployment guide.

---

## Troubleshooting

### Agent Desktop shows "FS Offline" badge

The backend cannot reach FreeSWITCH ESL. Check:
1. `FS_ESL_HOST` in `.env` is the correct FreeSWITCH IP
2. Port 8021 is open on the FreeSWITCH host
3. `FS_ESL_PASSWORD` matches `event_socket_conf.xml`

### Agent Desktop login: "No PIN set"

The agent has no PIN configured. Go to Admin UI → **Agents** → click the key icon (🔑) to set one.

### Agent Desktop login: "Invalid credentials"

- Check the Agent ID exactly matches the FreeSWITCH agent name (case-sensitive, e.g. `Agent_1001@default`)
- Verify the agent row exists in the `agents` table: `SELECT agent_id, pin_hash IS NOT NULL AS has_pin FROM agents;`

### Socket.IO connection refused on Agent Desktop (dev)

Ensure `backend/.env` includes both origins:
```
CORS_ORIGIN=http://localhost:5173,http://localhost:8080
```
Then restart the backend.

### Queue cards show all zeros

Queues must be assigned via the Admin UI → **Queues** and agents must be added as members (tiers). The stats query joins `agent_tiers` to filter by the logged-in agent.

### "Cannot find module" on backend start

Run `npm install` inside the `backend/` directory.

### DB migration fails with "column already exists"

The migrations use `ADD COLUMN IF NOT EXISTS` — safe to re-run. If the error is different, check the full psql output for the specific statement.

---

## Developer Onboarding Checklist

- [ ] Clone repo to local machine
- [ ] Install Node 20, PostgreSQL 14+
- [ ] Copy `.env.example` → `.env`; set `DB_PASSWORD` and `JWT_SECRET`
- [ ] Set `DB_HOST=localhost` in `backend/.env` (or root `.env`)
- [ ] Set `CORS_ORIGIN=http://localhost:5173,http://localhost:8080` in `backend/.env`
- [ ] Run all 7 SQL migrations
- [ ] `npm install` in `backend/`, `frontend/`, `agent-desktop/`
- [ ] Start backend + both UIs (`npm run dev` or PM2)
- [ ] Register first admin via `POST /api/auth/register`
- [ ] Log in to Admin UI at `http://localhost:5173`
- [ ] Create an agent in Admin UI
- [ ] Set a PIN for that agent (key icon in Agents table)
- [ ] Log in to Agent Desktop at `http://localhost:8080`
- [ ] Verify queues appear (agent must be a tier member of at least one queue)
- [ ] Optionally configure `FS_ESL_HOST` to connect to a FreeSWITCH dev instance
