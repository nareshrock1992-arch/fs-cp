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

## 10. MANDATORY RULES FOR FUTURE CLAUDE WORK

**At the start of every session working in fs-cp, Claude MUST:**

1. Read `FS-CP-GOVERNANCE.md` (this file) before writing any code or making any changes.
2. Read `deploy/DEPLOYMENT-GUIDE.md` to understand the current deployment architecture.
3. Classify every proposed change using the four-category system in §1 of this document.

**Never:**
- Modify application logic inside `fs-cp/fs-enrs/` or `fs-cp/fs-cc/` directly. All application changes must originate in the dev repos and flow in via sync.
- Modify `deploy/docker-compose.yml` without explicit user instruction.
- Deploy to remote servers, push to git, or delete Docker volumes without explicit user instruction.
- Commit `deploy/.env` — it is excluded by `deploy/.gitignore`. If it appears in `git status`, run `git rm --cached deploy/.env` immediately.
- Commit any `backend/.env` or `.env` file from the application directories.

**Always:**
- When syncing app code, show the user the file list before copying.
- When discovering a bug in application code, report it as "Requires fix in fs-enrs" or "Requires fix in fs-cc" — do NOT silently modify the embedded copy.
- When making any change that affects deployment (env vars, ports, volumes, healthchecks, migration behavior, permissions), update `deploy/DEPLOYMENT-GUIDE.md` as part of the same change.

---

## 11. DEPLOYMENT GUIDE MAINTENANCE RULE

`deploy/DEPLOYMENT-GUIDE.md` is the permanent operational reference for all deployments.

**Whenever any of the following changes:**
- Environment variable names, defaults, or required/optional status
- Service ports, URLs, or routing
- Volume mounts or host directory requirements
- FreeSWITCH permission requirements
- Healthcheck endpoints or behavior
- Migration startup sequence
- Admin bootstrap process
- Docker service names or build contexts
- Deployment commands

**The deployer MUST also update `deploy/DEPLOYMENT-GUIDE.md`** in the same commit.

Deployment knowledge must never exist only in source code or conversation history. The guide is the single authoritative reference for operators.

---

## 12. Admin Bootstrap Variable Names (Critical — Do Not Change)

The environment variable names for first-boot admin creation are fixed by the application code. These must match exactly:

| Application | Compose env var | Code reads | Seed script |
|---|---|---|---|
| ENRS | `INITIAL_ADMIN_EMAIL` | `process.env.INITIAL_ADMIN_EMAIL` | `src/db/seed-initial-admin.js` |
| ENRS | `INITIAL_ADMIN_PASSWORD` | `process.env.INITIAL_ADMIN_PASSWORD` | same |
| ENRS | `INITIAL_ADMIN_NAME` | `process.env.INITIAL_ADMIN_NAME` | same |
| CC | `CC_INITIAL_ADMIN_USERNAME` | `process.env.CC_INITIAL_ADMIN_USERNAME` | `scripts/seed-initial-admin.js` |
| CC | `CC_INITIAL_ADMIN_PASSWORD` | `process.env.CC_INITIAL_ADMIN_PASSWORD` | same |

If these variable names change in application code (fs-enrs or fs-cc), both `docker-compose.yml` and `deploy/.env` must be updated in the same sync.

---

## 13. Log Directory Names (Critical — Must Match Compose)

The `prepare-directories.sh` script creates host-side log directories that must exactly match the bind-mount sources in `docker-compose.yml`. Current mapping:

| compose volume source | host path (relative to deploy/) | correct script dir name |
|---|---|---|
| `./logs/nginx` | `deploy/logs/nginx` | `logs/nginx` ✅ |
| `./logs/cc` | `deploy/logs/cc` | `logs/cc` ✅ |
| `./logs/enrs` | `deploy/logs/enrs` | `logs/enrs` ✅ |
| `./uploads/cc` | `deploy/uploads/cc` | `uploads/cc` ✅ |
| `./uploads/enrs` | `deploy/uploads/enrs` | `uploads/enrs` ✅ |

If new volume mounts are added to `docker-compose.yml`, add matching `make_dir` calls to `prepare-directories.sh`.
