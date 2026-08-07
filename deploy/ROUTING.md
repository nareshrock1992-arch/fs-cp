# Omni Platform — Routing Architecture

## The Three-Variable Contract

Every frontend build is governed by three environment variables baked in at build time via Vite ARGs:

| Variable | What it controls | Dev default | Prod value |
|---|---|---|---|
| `VITE_BASE_PATH` | Vite `--base`, BrowserRouter `basename`, asset URL prefix | `/` (implicit) | `/cc/`, `/agent/`, `/enrs/` |
| `VITE_API_URL` | `BASE` in `client.js` — prefixes all browser API calls | `/api` or `/api/v1` | `/cc/api`, `/enrs/api/v1` |
| `VITE_SOCKET_PATH` | Socket.IO `path:` option in `socket.js` | `/socket.io` | `/cc/socket.io`, `/enrs/socket.io` |

All three are inert in the frontend `.env` (dev values). The Dockerfile ARGs override them at image build time for production. Docker Compose passes the prod values from `.env` → Dockerfile ARG → system ENV → Vite build.

**Vite precedence rule:** system `ENV` variables set in the Dockerfile override `.env` file values. The `.env` file is copied into the image and is used as the fallback, never the override.

---

## URL Flow — End to End

### Contact Center (CC)

```
Browser                     nginx                       cc-backend:4000
──────                      ─────                       ───────────────
GET  /cc/                   location /cc/
                            proxy_pass http://cc_frontend/;   → cc-frontend:80  (SPA)

POST /cc/api/auth/login     location /cc/api/auth/
                            proxy_pass http://cc_backend/api/auth/;
                                                        POST /api/auth/login  ✓

GET  /cc/api/agents         location /cc/api/
                            proxy_pass http://cc_backend/api/;
                                                        GET  /api/agents  ✓

WS   /cc/socket.io/?EIO=4  location /cc/socket.io
                            proxy_pass http://cc_backend/cc/socket.io;
                                                        WS /cc/socket.io/?EIO=4  ✓
                                                        (backend SOCKET_PATH=/cc/socket.io)
```

### Agent Desktop

```
Browser                     nginx                       cc-backend:4000
──────                      ─────                       ───────────────
GET  /agent/                location /agent/
                            proxy_pass http://agent_desktop/;   → agent-desktop:80 (SPA)

POST /cc/api/auth/login     (same as CC — shares cc-backend)
WS   /cc/socket.io/?EIO=4   (same as CC — shares SOCKET_PATH)
```

### ENRS

```
Browser                          nginx                        enrs-backend:4100
──────                           ─────                        ─────────────────
GET  /enrs/                      location /enrs/
                                 proxy_pass http://enrs_frontend/;  → enrs-frontend:80 (SPA)

POST /enrs/api/v1/auth/login     location /enrs/api/v1/auth/
                                 proxy_pass http://enrs_backend/api/v1/auth/;
                                                              POST /api/v1/auth/login  ✓
                                                              (auth rate-limit: 5 r/s)

GET  /enrs/api/v1/users          location /enrs/api/
                                 proxy_pass http://enrs_backend/api/;
                                                              GET  /api/v1/users  ✓

GET  /enrs/api/v1/internal/...   location /enrs/api/v1/internal/
                                 deny all; return 403;        ← BLOCKED (Lua-only API)

GET  /enrs/health/ready          location /enrs/health/
                                 proxy_pass http://enrs_backend/health/;
                                                              GET  /health/ready  ✓

WS   /enrs/socket.io/?EIO=4      location /enrs/socket.io
                                 proxy_pass http://enrs_backend/enrs/socket.io;
                                                              WS /enrs/socket.io/?EIO=4  ✓
                                                              (backend SOCKET_PATH=/enrs/socket.io)
```

---

## URL Mapping Table

| What | Browser sends | nginx location | Backend receives |
|---|---|---|---|
| CC SPA assets | `GET /cc/*` | `/cc/` | cc-frontend:80 `/` |
| CC auth | `POST /cc/api/auth/login` | `/cc/api/auth/` (5 r/s) | cc-backend `/api/auth/login` |
| CC API | `GET /cc/api/agents` | `/cc/api/` (30 r/s) | cc-backend `/api/agents` |
| CC socket | `WS /cc/socket.io` | `/cc/socket.io` | cc-backend `/cc/socket.io` |
| Agent SPA assets | `GET /agent/*` | `/agent/` | agent-desktop:80 `/` |
| Agent auth | `POST /cc/api/auth/login` | `/cc/api/auth/` (5 r/s) | cc-backend `/api/auth/login` |
| Agent socket | `WS /cc/socket.io` | `/cc/socket.io` | cc-backend `/cc/socket.io` |
| ENRS SPA assets | `GET /enrs/*` | `/enrs/` | enrs-frontend:80 `/` |
| ENRS auth | `POST /enrs/api/v1/auth/login` | `/enrs/api/v1/auth/` (5 r/s) | enrs-backend `/api/v1/auth/login` |
| ENRS API | `GET /enrs/api/v1/users` | `/enrs/api/` (30 r/s) | enrs-backend `/api/v1/users` |
| ENRS internal | `ANY /enrs/api/v1/internal/*` | `/enrs/api/v1/internal/` | **403 BLOCKED** |
| ENRS health | `GET /enrs/health/ready` | `/enrs/health/` | enrs-backend `/health/ready` |
| ENRS socket | `WS /enrs/socket.io` | `/enrs/socket.io` | enrs-backend `/enrs/socket.io` |

---

## Dev vs. Prod Comparison

| Concern | Dev (`npm run dev`) | Prod (Docker + nginx) |
|---|---|---|
| Frontend served at | `http://localhost:5173/` (CC) | `https://<host>/cc/` |
| API calls | `/api/auth/login` → Vite proxy → `localhost:4000` | `/cc/api/auth/login` → nginx → cc-backend |
| Socket handshake | `/socket.io/?EIO=4` | `/cc/socket.io/?EIO=4` |
| `VITE_API_URL` | `/api` (from `.env`) | `/cc/api` (from Dockerfile ARG) |
| `VITE_SOCKET_PATH` | `/socket.io` (from `.env`) | `/cc/socket.io` (from Dockerfile ARG) |
| `import.meta.env.BASE_URL` | `/` | `/cc/` |
| Session-expired redirect | `window.location → /login` | `window.location → /cc/login` |
| Token stream URLs | `/api/v1/media-library/x/stream` | `/enrs/api/v1/media-library/x/stream` |

---

## Routing Invariants

1. **Never hardcode `/api/v1/` in frontend code.** Always use the `BASE` / `API_URL` constant derived from `import.meta.env.VITE_API_URL`.
2. **Never hardcode `/login` for redirects.** Use `(import.meta.env.BASE_URL || '/') + 'login'`.
3. **Never hardcode `/socket.io` in `socket.js`.** Use `import.meta.env.VITE_SOCKET_PATH || '/socket.io'`.
4. **Token-bearing stream URLs** (`<audio src>`, `<a download>`) cannot carry Authorization headers — they use `?token=` query param. These must also go through `BASE`, not a hardcoded path.
5. **The internal API** (`/api/v1/internal/*`) is blocked at the nginx layer for all ENRS paths. It is never reachable from the internet regardless of frontend code.
6. **Changing `SERVER_NAME`** in `.env` (IP → domain) requires no code changes — nginx injects it via `envsubst` at startup.

---

## Troubleshooting

### 404 on login / API calls (prod)

Symptom: browser DevTools shows `POST /api/v1/auth/login` 404.

Cause: `VITE_API_URL` was not baked into the image. The build used the dev `.env` value (`/api/v1`) instead of the Dockerfile ARG value (`/enrs/api/v1`).

Fix: rebuild the frontend image. The Dockerfile ARG takes precedence over `.env` only when the image is built via `docker compose build` with the compose `args:` block. Verify with:
```bash
docker run --rm omni/enrs-frontend:latest printenv VITE_API_URL
# expected: /enrs/api/v1
```

### 404 on audio stream / recording download (prod)

Symptom: `GET /api/v1/media-library/123/stream` 404 in nginx.

Cause: hardcoded `/api/v1/` path in `client.js` — not going through `BASE`. All stream/download URLs must use `${BASE}/...`.

### Socket.IO connection fails (prod)

Symptom: WebSocket handshake to `/socket.io/` fails with 404.

Cause: `VITE_SOCKET_PATH` not baked in, or backend `SOCKET_PATH` env var not set. Verify both ends:
- Frontend: `import.meta.env.VITE_SOCKET_PATH` should equal `/cc/socket.io` or `/enrs/socket.io`
- Backend: `process.env.SOCKET_PATH` must match (set via compose `environment:`)

### Session-expired redirect goes to server root (prod)

Symptom: after token expiry, browser lands on `/login` (404) instead of `/cc/login`.

Cause: redirect was `window.location.href = '/login'` — absolute path ignores `BASE_URL`.

Fix: `window.location.href = (import.meta.env.BASE_URL || '/') + 'login'`.

### Auth rate-limit not applied (ENRS)

The ENRS auth rate-limit location is `/enrs/api/v1/auth/` (includes the `/v1/` version segment). This correctly matches requests from `VITE_API_URL=/enrs/api/v1`. A location at `/enrs/api/auth/` would never match and is wrong for ENRS.
