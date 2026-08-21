# FS-CP-GOVERNANCE.md

Permanent governance document for the `fs-cp` repository.
Created: 2026-08-21. Authoritative for all future Claude Code sessions working in this repo.

---

## 1. Role of fs-cp

**fs-cp is the deployment/integration repository.** It owns:
- Docker Compose orchestration (`docker-compose.yml`)
- Nginx reverse-proxy configuration (`nginx/`)
- PostgreSQL seed SQL and schemas for the production stack
- Shell scripts for deployment, backup, and startup (`scripts/`)
- SSL certificate mounts (`ssl/`)
- Environment template files

**fs-cp does NOT own application logic.** Application code originates in:
- `fs-enrs` — the ENRS backend/frontend/Lua-scripts authoritative source
- `fs-cc` — the FreeSWITCH Call-Center backend/frontend/agent-desktop authoritative source

Code flows **into** fs-cp from those repos. It never flows the other direction.

---

## 2. Repository Structure

```
fs-cp/
├── fs-enrs/                    # Application code mirror (nested git repo — see §3)
├── fs-cc/                      # Application code mirror (plain file copy — see §3)
├── deploy/                     # All deployment artefacts
│   ├── docker-compose.yml      # Master compose for all services
│   ├── docker-compose.yml.bkp  # Previous working compose (keep as rollback)
│   ├── nginx/                  # Nginx config (sub-path routing)
│   ├── postgres/               # Postgres init scripts
│   ├── scripts/                # Deployment + backup shell scripts
│   ├── ssl/                    # TLS cert mounts
│   ├── uploads/                # Shared uploads volume
│   ├── recordings/             # Shared recordings volume
│   ├── redis/                  # Redis config
│   ├── backups/                # Backup storage
│   └── logs/                   # Log output
├── CLAUDE.md
└── FS-CP-GOVERNANCE.md         # This file
```

---

## 3. How Application Code Enters fs-cp

### fs-enrs/
- Contains a **nested git repository** (its own `.git` directory).
- The outer fs-cp git tracks the files inside `fs-enrs/` as regular files (not a submodule — there is no `.gitmodules`).
- The inner `.git` in `fs-enrs/` is ignored by the outer git.
- **Sync rule:** Copy changed application files from the dev `fs-enrs` repo into `fs-cp/fs-enrs/`. Do NOT touch `fs-enrs/.git`. Do NOT re-run `git` commands inside `fs-enrs/` from the fs-cp context.

### fs-cc/
- Contains a **plain file copy** — no `.git` directory.
- **Sync rule:** Copy changed application files from the dev `fs-cc` repo into `fs-cp/fs-cc/`.

---

## 4. What to Copy vs. What to Exclude

### Always copy
- `backend/src/**` — application source code
- `frontend/src/**` — frontend source code
- `backend/db/migrations/**` — database migrations (new or updated)
- `backend/db/migrationRunner.js` — migration runner
- `backend/server.js` — application entry point
- `backend/controllers/**`, `backend/services/**` — application logic
- `Lua-scripts/**` — FreeSWITCH Lua scripts
- `backend/package.json`, `frontend/package.json` — dependency manifests
- `backend/Dockerfile`, `frontend/Dockerfile` — container build files
- `backend/docker-entrypoint.sh` — container startup hook
- `.env.example` files — safe templates

### Never copy
- `backend/.env`, `.env` — environment secrets; each environment has its own
- `.claude/` — developer tool config, not production
- `PHASE_*.md`, `PHASE_*_REPORT.md` — development-phase documentation
- `*.gitignore` from app repos — fs-cp manages its own `.gitignore`

### Conditionally copy
- `CLAUDE.md`, `GOVERNANCE.md` from app repos — only copy if fs-cp does not have an equivalent; otherwise merge relevant sections manually
- `docs/` subdirectories — useful reference material, copy unless content is dev-only

---

## 5. Docker Architecture

### Services (docker-compose.yml)
| Service | Image | Port | Notes |
|---|---|---|---|
| postgres | postgres:16 | 5432 | Two DBs: `fs_enrs` + `fs_cc` |
| redis | redis:7-alpine | 6379 | Session/queue store |
| enrs-backend | Built from `fs-enrs/backend/Dockerfile` | 4100 | JWT auth, Socket.IO |
| cc-backend | Built from `fs-cc/backend/Dockerfile` | 4200 | Agent reporting |
| enrs-frontend | Built from `fs-enrs/frontend/Dockerfile` | 8100 | Vite static |
| cc-frontend | Built from `fs-cc/frontend/Dockerfile` | 8200 | Vite static |
| agent-desktop | Built from `fs-cc/agent-desktop/Dockerfile` | 8300 | Agent UI |
| nginx | nginx:alpine | 80, 443 | Sub-path routing |

FreeSWITCH runs **on the host**, not in Docker. Containers reach it via `host.docker.internal`.

### Sub-path routing (nginx)
- `/enrs/` → enrs-backend + enrs-frontend
- `/cc/` → cc-backend + cc-frontend
- `/agent/` → agent-desktop
- `/api/v1/*` → proxied to respective backend by prefix

### Network
Single bridge network: `omni-net` (`172.30.0.0/24`).

---

## 6. Database Rules

- Two PostgreSQL databases in one shared instance: `fs_enrs` and `fs_cc`.
- Each database has its own migration runner; they are independent.
- `fs_enrs` migrations: `fs-enrs/backend/src/db/migrations/` (numbered 001–046+)
- `fs_cc` migrations: `fs-cc/backend/db/migrations/` (numbered 001–006+)
- Migrations run automatically at container startup via advisory lock (safe for parallel container starts).
- Never manually edit a migration that has already been applied to a live database. Add a new numbered migration instead.

---

## 7. Sync Protocol (for Claude Code sessions)

When syncing changes from dev repos into fs-cp:

1. **Identify divergence:** Compare `fs-cp/fs-enrs` HEAD (inner git) with dev `fs-enrs` HEAD. Compare `fs-cp/fs-cc` file timestamps with dev `fs-cc` HEAD.
2. **Determine changed files:** Use `git diff --name-only <old-sha> <new-sha>` in the dev repo.
3. **Filter:** Apply the include/exclude rules from §4.
4. **Copy files:** Use PowerShell `Copy-Item` or `robocopy /S` (no `/PURGE`) to copy changed files.
5. **Do NOT** run migrations, build Docker images, or push to git unless explicitly instructed.
6. **Commit in fs-cp:** Stage all changed files under `fs-enrs/` and `fs-cc/`, commit with a message describing what was synced and from which SHA.

---

## 8. Security Rules

- **Never commit** `backend/.env` or any `.env` file containing real credentials.
- The `.env` in `fs-cp/fs-cc/backend/` is a **known security debt** — the dev repo committed it. Do NOT propagate it to fs-cp. Verify it is in `.gitignore`.
- `INTERNAL_API_KEY`, database passwords, JWT secrets — all must come from environment variables at runtime, never baked into committed files.
- The nginx SSL certs in `ssl/` are mount-points only; actual cert files are excluded from git.

---

## 9. modesl Version Note

- `fs-enrs` uses `modesl: ^1.2.1` (ESL library)
- `fs-cc` uses `modesl: ^1.0.3`

These are independent — do not unify. Each uses the version appropriate for its ESL event requirements.

---

## 10. Future Claude Code Rules

When working in this repository:

1. Read this file at the start of every session.
2. Read `CLAUDE.md` in `fs-cp` root (if present) for additional session guidance.
3. **Never modify application logic inside `fs-cp/fs-enrs/` or `fs-cp/fs-cc/`** directly. All application changes must originate in the dev repos (`fs-enrs`, `fs-cc`) and flow in via sync.
4. **Never modify `deploy/docker-compose.yml`** without explicit user instruction; it is the production deployment manifest.
5. **Never deploy to remote servers** or push to git without explicit user instruction.
6. When asked to sync, always show the user the list of files that will change before making changes.
7. Treat the dev repos (`C:\Users\USER\Documents\fs-enrs` and `C:\Users\USER\Documents\fs-cc`) as the source of truth for application code. Treat fs-cp as the destination.
