# Developer Environment Guide

This guide explains how to run the project locally (without Docker) and how the
dev and production environments coexist safely after the configuration refactor.

---

## Architecture comparison

```
┌─────────────────────────────────────────────────────┐
│  PRODUCTION (Docker Compose)                        │
│                                                     │
│  Browser → http://SERVER_IP:8000                    │
│       └─→ Nginx (port 80 inside container)          │
│             ├─ /api/*      → backend:4000           │
│             ├─ /socket.io/ → backend:4000 (WS)      │
│             └─ /*          → React SPA              │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  DEVELOPMENT (local processes)                      │
│                                                     │
│  Browser → http://localhost:5173                    │
│       └─→ Vite dev server (port 5173)               │
│             ├─ /api/*      → proxy → localhost:4000 │
│             ├─ /socket.io/ → proxy → localhost:4000 │
│             └─ /*          → React HMR              │
└─────────────────────────────────────────────────────┘
```

In both environments, the frontend uses **identical relative paths** (`/api`, `/socket.io`).
The proxy (Nginx or Vite) handles routing — no IP is ever baked into the frontend code.

---

## Dev setup

### Prerequisites
- Node.js 20+
- PostgreSQL running locally
- FreeSWITCH with ESL accessible

### 1. Backend

```bash
cd backend
npm install

# backend/.env is already configured for local dev:
#   DB_HOST=localhost
#   FS_ESL_HOST=127.0.0.1 (or your FS server IP)
#   CORS_ORIGIN=http://localhost:5173

npm run dev
# → API running on http://localhost:4000
```

### 2. Frontend

```bash
cd frontend
npm install

# frontend/.env is already configured for dev:
#   VITE_API_URL=/api
#   VITE_BACKEND_DEV_URL=http://localhost:4000

npm run dev
# → UI running on http://localhost:5173
```

### 3. What the Vite proxy does

`vite.config.js` reads `VITE_BACKEND_DEV_URL` (default `http://localhost:4000`) and proxies:
- `http://localhost:5173/api/*`      → `http://localhost:4000/api/*`
- `http://localhost:5173/socket.io/` → `http://localhost:4000/socket.io/` (WebSocket)

This is identical to what Nginx does in production.

---

## Dev .env files

### `backend/.env` (local dev only)
```env
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173   # Vite dev server
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fs_cc
DB_USER=fs_cc
DB_PASSWORD=changeme
FS_ESL_HOST=127.0.0.1              # or your FS LAN IP
FS_ESL_PORT=8021
FS_ESL_PASSWORD=ClueCon
JWT_SECRET=dev-only-secret
```

### `frontend/.env` (local dev only)
```env
VITE_API_URL=/api
VITE_SOCKET_URL=
VITE_BACKEND_DEV_URL=http://localhost:4000
VITE_DEV_PORT=5173
```

---

## FS_ESL_HOST in dev

If FreeSWITCH is on a **different LAN machine** from your dev laptop:

```env
# backend/.env
FS_ESL_HOST=192.168.1.50    # IP of your FreeSWITCH server
```

CORS is never an issue here because ESL is a TCP socket connection from the
backend — browsers are not involved.

---

## CORS in dev

`CORS_ORIGIN=http://localhost:5173` in `backend/.env` allows the Vite dev
server (which the browser talks to) to make API calls. Nothing else is needed.

---

## Socket.IO in dev

`socket.js` connects to `io('/')` — the current page's origin (localhost:5173).
Vite proxies `/socket.io` to `localhost:4000`. WebSocket upgrades are preserved
by the `ws: true` flag in `vite.config.js`. It works identically to production.

---

## Dev vs Docker — coexistence

| File | Used by | Purpose |
|---|---|---|
| `backend/.env` | `npm run dev` | Local backend config |
| `frontend/.env` | `npm run dev` | Local frontend config |
| `.env` (root) | `docker compose` | Production config |

Docker Compose reads **only** the root `.env`. It ignores `backend/.env` and
`frontend/.env`. You can change one without affecting the other.

---

## Migration checklist (after this refactor)

- [ ] Delete any old hardcoded IP from `frontend/.env`
- [ ] Set `VITE_API_URL=/api` in `frontend/.env`  
- [ ] Set `CORS_ORIGIN=http://localhost:5173` in `backend/.env`
- [ ] Set `FS_ESL_HOST` to your FreeSWITCH IP in `backend/.env`
- [ ] Confirm `vite.config.js` points to correct `VITE_BACKEND_DEV_URL`
- [ ] Run `npm run dev` in both `backend/` and `frontend/` — verify login works
- [ ] Verify live calls page updates in real-time (Socket.IO working)
- [ ] Verify FreeSWITCH ESL connects (`Contact Center Connected` in topbar)
