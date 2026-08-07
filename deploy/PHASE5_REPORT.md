# Phase 5 — Platform Routing Hardening: Final Report

## Root Cause

In production, every frontend is served under a sub-path prefix (`/cc/`, `/enrs/`, `/agent/`). nginx strips the prefix before forwarding to backend containers. The frontend must therefore include that prefix when constructing API request URLs, Socket.IO connection paths, and browser redirect targets.

The deployment failures were caused by frontends sending bare paths (e.g. `POST /api/v1/auth/login`) that nginx has no route for under the sub-path topology (nginx only exposes `/enrs/api/`, not `/api/`). The root cause in each case was the same: the sub-path prefix was not baked into the frontend bundle at build time.

---

## Changes Made

### 1. `fs-enrs/frontend/Dockerfile`

**Added `VITE_API_URL` ARG and ENV.**

```dockerfile
ARG VITE_API_URL=/enrs/api/v1
ENV VITE_API_URL=${VITE_API_URL}
```

Why: Vite bakes `VITE_*` system env vars into the bundle at build time. Without this, `import.meta.env.VITE_API_URL` is undefined in production and `client.js` falls back to `/api/v1` — a path nginx cannot route.

### 2. `fs-cc/frontend/Dockerfile`

**Added `VITE_API_URL` ARG and ENV.**

```dockerfile
ARG VITE_API_URL=/cc/api
ENV VITE_API_URL=${VITE_API_URL}
```

Same reason as ENRS above. CC API base has no version segment — the backend routes are under `/api/`, not `/api/v1/`.

### 3. `fs-cc/agent-desktop/Dockerfile`

**Added `VITE_API_URL` ARG and ENV.**

```dockerfile
ARG VITE_API_URL=/cc/api
ENV VITE_API_URL=${VITE_API_URL}
```

Agent Desktop shares the CC backend and therefore uses `CC_API_BASE` — same value as the CC frontend.

### 4. `deploy/docker-compose.yml`

**Added `VITE_API_URL` to the `build.args` block of all three frontend services.**

```yaml
cc-frontend:
  build:
    args:
      VITE_API_URL: ${CC_API_BASE}

agent-desktop:
  build:
    args:
      VITE_API_URL: ${CC_API_BASE}

enrs-frontend:
  build:
    args:
      VITE_API_URL: ${ENRS_API_BASE}
```

Why: Docker Compose `build.args` is the bridge from `.env` variables to Dockerfile ARGs. Without this, the Dockerfile ARG defaults are used regardless of what is in `.env`.

### 5. `deploy/.env.example`

**Added `CC_API_BASE` and `ENRS_API_BASE` with full explanatory comments.**

```
CC_API_BASE=/cc/api
ENRS_API_BASE=/enrs/api/v1
```

Why: these were previously undocumented. Operators copying `.env.example` had no way to know these values existed or what they controlled.

### 6. `fs-cc/frontend/src/api/client.js`

**Two fixes:**

a) Updated stale comment that said `VITE_API_URL should always be '/api'` — it should be `/cc/api` in production.

b) Fixed session-expired redirect:
```js
// Before:
window.location.href = '/login';
// After:
window.location.href = (import.meta.env.BASE_URL || '/') + 'login';
```

Why: `/login` is an absolute path from the server root. When CC is served at `/cc/`, the correct login URL is `/cc/login`. `BASE_URL` is populated by Vite from the `--base` flag at build time.

### 7. `fs-enrs/frontend/src/api/client.js`

**Three fixes:**

a) Fixed session-expired redirect (same as CC above).

b) Fixed 3 hardcoded `mediaLibrary` stream URLs:
```js
// Before:
streamUrl:   (id) => `/api/v1/media-library/${id}/stream?token=...`,
downloadUrl: (id) => `/api/v1/media-library/${id}/download?token=...`,
waveformUrl: (id) => `/api/v1/media-library/${id}/waveform?token=...`,
// After:
streamUrl:   (id) => `${BASE}/media-library/${id}/stream?token=...`,
downloadUrl: (id) => `${BASE}/media-library/${id}/download?token=...`,
waveformUrl: (id) => `${BASE}/media-library/${id}/waveform?token=...`,
```

c) Fixed 2 hardcoded `recordings` stream URLs (same pattern).

Why: `<audio src>` and `<a download>` cannot send Authorization headers. Token is passed as query param. These URLs were hardcoded to `/api/v1/...` — under the sub-path deployment, nginx sees `/api/v1/...` with no matching route and returns 404. Using `${BASE}` ensures the sub-path prefix is included.

### 8. `fs-enrs/frontend/vite.config.js`

**Updated to use `loadEnv` and `VITE_BACKEND_DEV_URL`**, matching the cc-frontend pattern.

```js
// Before: hardcoded http://localhost:4100 everywhere
// After:
const backendTarget = env.VITE_BACKEND_DEV_URL || 'http://localhost:4100';
```

Why: consistency with cc-frontend; allows operators to override the dev backend URL without editing `vite.config.js`. Also supports `VITE_DEV_PORT` override.

### 9. `deploy/nginx/conf.d/omni.conf.template`

**Fixed ENRS auth rate-limit location.**

```nginx
# Before:
location /enrs/api/auth/ {
    limit_req zone=auth burst=10 nodelay;
    proxy_pass http://enrs_backend/api/auth/;
}

# After:
location /enrs/api/v1/auth/ {
    limit_req zone=auth burst=10 nodelay;
    proxy_pass http://enrs_backend/api/v1/auth/;
}
```

Why: with `ENRS_API_BASE=/enrs/api/v1`, auth requests arrive as `POST /enrs/api/v1/auth/login`. The old location `/enrs/api/auth/` never matched (the `/v1/` segment sits between `/api/` and `/auth/`), so every ENRS auth request fell through to the general API location with the looser 30 r/s rate limit. The CC equivalent (`/cc/api/auth/`) works correctly because CC has no version segment.

### 10. `.env` files — dev frontends

**`fs-cc/frontend/.env`**: renamed `VITE_SOCKET_URL=` (wrong name, read by nothing) → `VITE_SOCKET_PATH=/socket.io` (correct name, read by `socket.js`).

**`fs-enrs/frontend/.env`**: added `VITE_SOCKET_PATH=/socket.io`, `VITE_BACKEND_DEV_URL`, `VITE_DEV_PORT`, and header comment matching the cc-frontend pattern.

**`fs-cc/agent-desktop/.env`**: added `VITE_SOCKET_PATH=/socket.io` and header comment.

Why: makes all three dev `.env` files consistent and self-documenting. The stale `VITE_SOCKET_URL` variable was silently doing nothing.

---

## What Was Already Correct (No Changes Needed)

- All three `socket.js` files: already used `import.meta.env.VITE_SOCKET_PATH || '/socket.io'`
- All three `main.jsx` files: already used `basename={import.meta.env.BASE_URL}`
- nginx Socket.IO locations: already forwarded the full `/cc/socket.io` and `/enrs/socket.io` paths to backends (which listen on those exact paths via `SOCKET_PATH` env var)
- ENRS `/api/v1/internal/` block: already blocked at nginx; unchanged

---

## Deployment Validation Checklist

After rebuilding images (`docker compose build`), verify:

```bash
# 1. Confirm VITE_API_URL baked into images
docker run --rm omni/cc-frontend:latest    printenv VITE_API_URL  # → /cc/api
docker run --rm omni/agent-desktop:latest  printenv VITE_API_URL  # → /cc/api
docker run --rm omni/enrs-frontend:latest  printenv VITE_API_URL  # → /enrs/api/v1

# 2. Confirm VITE_SOCKET_PATH baked into images
docker run --rm omni/cc-frontend:latest    printenv VITE_SOCKET_PATH  # → /cc/socket.io
docker run --rm omni/agent-desktop:latest  printenv VITE_SOCKET_PATH  # → /cc/socket.io
docker run --rm omni/enrs-frontend:latest  printenv VITE_SOCKET_PATH  # → /enrs/socket.io

# 3. Login works
curl -sk https://<host>/cc/api/auth/login   -d '{"username":"...","password":"..."}' -H 'Content-Type: application/json' | jq .
curl -sk https://<host>/enrs/api/v1/auth/login -d '{"email":"...","password":"..."}' -H 'Content-Type: application/json' | jq .

# 4. Internal API is blocked
curl -sk https://<host>/enrs/api/v1/internal/ers/lookup  # must return 403

# 5. ENRS health
curl -sk https://<host>/enrs/health/ready  # must return {"status":"ok"} or similar

# 6. Socket.IO handshake (expect 101 Switching Protocols)
curl -sk -i "https://<host>/cc/socket.io/?EIO=4&transport=websocket" -H "Upgrade: websocket" | head -5
curl -sk -i "https://<host>/enrs/socket.io/?EIO=4&transport=websocket" -H "Upgrade: websocket" | head -5
```

---

## Files Changed

| File | Change |
|---|---|
| `fs-enrs/frontend/Dockerfile` | Add `VITE_API_URL` ARG + ENV |
| `fs-cc/frontend/Dockerfile` | Add `VITE_API_URL` ARG + ENV |
| `fs-cc/agent-desktop/Dockerfile` | Add `VITE_API_URL` ARG + ENV |
| `deploy/docker-compose.yml` | Add `VITE_API_URL` build arg to all 3 frontend services |
| `deploy/.env.example` | Add `CC_API_BASE` and `ENRS_API_BASE` with comments |
| `fs-cc/frontend/src/api/client.js` | Fix stale comment + session redirect |
| `fs-enrs/frontend/src/api/client.js` | Fix session redirect + 5 hardcoded stream URLs |
| `fs-enrs/frontend/vite.config.js` | Use `loadEnv` + `VITE_BACKEND_DEV_URL` |
| `deploy/nginx/conf.d/omni.conf.template` | Fix ENRS auth rate-limit location (`/v1/auth/`) |
| `fs-cc/frontend/.env` | Rename `VITE_SOCKET_URL` → `VITE_SOCKET_PATH` |
| `fs-enrs/frontend/.env` | Add `VITE_SOCKET_PATH`, `VITE_BACKEND_DEV_URL`, `VITE_DEV_PORT` |
| `fs-cc/agent-desktop/.env` | Add `VITE_SOCKET_PATH` and header comment |
| `deploy/ROUTING.md` | New — routing architecture reference document |
