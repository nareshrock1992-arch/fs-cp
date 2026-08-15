# Omni Platform — Deployment Guide

**Target OS:** Debian Bookworm (12)
**Architecture:** FreeSWITCH on host + Docker Compose stack

---

## Prerequisites

Install these before starting:

```bash
# Docker Engine
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER
newgrp docker

# Docker Compose plugin (v2)
apt-get install -y docker-compose-plugin

# FreeSWITCH
# Follow: https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Installation/Linux/Debian/

# Supporting tools
apt-get install -y openssl curl git
```

Make deployment scripts executable after cloning:

```bash
chmod +x deploy/scripts/*.sh
```

---

## Deployment Steps

### Step 1 — Install prerequisites

Complete all prerequisite software above. Verify:

```bash
docker --version
docker compose version
freeswitch -version
openssl version
```

---

### Step 2 — Clone repository

```bash
git clone <repository-url> /opt/omni
cd /opt/omni
chmod +x deploy/scripts/*.sh
```

---

### Step 3 — Copy .env

```bash
cp deploy/.env.example deploy/.env
```

---

### Step 4 — Edit .env

```bash
nano deploy/.env
```

Change **every** value marked `(REQUIRED)`. Use these commands to generate secrets:

```bash
# For JWT secrets and API keys (minimum 32 chars):
openssl rand -hex 32

# For passwords:
openssl rand -base64 24
```

**Required changes:**

| Variable | Instructions |
|----------|-------------|
| `SERVER_NAME` | Server IP address (Phase 1) or domain name (Phase 2) |
| `SERVER_IP` | Same IP address (used by helper scripts) |
| `SIP_DOMAIN` | Same as `SERVER_NAME` for Phase 1 |
| `POSTGRES_ADMIN_PASSWORD` | `openssl rand -base64 24` |
| `CC_DB_PASSWORD` | `openssl rand -base64 24` |
| `ENRS_DB_PASSWORD` | `openssl rand -base64 24` — replace `changeme` |
| `REDIS_PASSWORD` | `openssl rand -base64 24` |
| `FS_ESL_PASSWORD` | Must match `event_socket.conf.xml` — change from `ClueCon` |
| `CC_JWT_SECRET` | `openssl rand -hex 32` — replace `CHANGE-IN-PRODUCTION` |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` — must differ from `JWT_ACCESS_SECRET` |
| `INTERNAL_API_KEY` | `openssl rand -hex 32` |
| `INITIAL_ADMIN_EMAIL` | Email address for the ENRS platform administrator account (created on first boot only) |
| `INITIAL_ADMIN_PASSWORD` | Password for the ENRS admin (≥8 chars, upper + lower + digit + special) |
| `INITIAL_ADMIN_NAME` | Display name (default: `System Administrator`) |
| `CC_INITIAL_ADMIN_USERNAME` | Username for the Contact Center administrator (3–64 chars: letters, digits, `.`, `_`, `-`) |
| `CC_INITIAL_ADMIN_PASSWORD` | Password for the CC administrator (min 8 chars) |
| All `FS_*` paths | Must match your FreeSWITCH installation |

**Find your FreeSWITCH paths:**

```bash
fs_cli -x "global_getvar conf_dir"
fs_cli -x "global_getvar scripts_dir"
fs_cli -x "global_getvar recordings_dir"
```

**Debian package path defaults** (SignalWire/FreeSWITCH packages):

```
FS_BASE_DIR=/usr/share/freeswitch
FS_CONF_DIR=/etc/freeswitch
FS_DIALPLAN_DIR=/etc/freeswitch/dialplan
FS_DIRECTORY_DIR=/etc/freeswitch/directory
FS_SIP_PROFILE_DIR=/etc/freeswitch/sip_profiles
FS_SCRIPT_DIR=/usr/share/freeswitch/scripts
FS_SOUND_DIR=/usr/share/freeswitch/sounds
FS_RECORDING_DIR=/var/lib/freeswitch/recordings
FS_STORAGE_DIR=/var/lib/freeswitch/storage
FS_DB_DIR=/var/lib/freeswitch/db
FS_LOG_DIR=/var/log/freeswitch
```

> Both backend startup guards will prevent the stack from starting if secrets are left as placeholders. This is intentional — the error output will tell you exactly which variable to fix.

---

### Step 5 — Prepare directories

```bash
sudo bash deploy/scripts/prepare-directories.sh
```

Creates all FreeSWITCH and application directories with correct ownership.

---

### Step 6 — Prepare FreeSWITCH

```bash
sudo bash deploy/scripts/prepare-freeswitch.sh
```

Updates `event_socket.conf.xml` with the ESL password and writes `FS_INTERNAL_KEY` + `ENRS_API_URL` into `vars.xml`. Backs up files before editing.

Verify after the script completes:

```bash
fs_cli -x "global_getvar FS_INTERNAL_KEY"
fs_cli -x "global_getvar ENRS_API_URL"
```

---

### Step 7 — Generate SSL certificate

```bash
bash deploy/scripts/generate-self-signed.sh
```

Generates a self-signed certificate for `SERVER_NAME` into `deploy/ssl/`. Required for Phase 1 (IP-based access). Replace with a real certificate for Phase 2.

---

### Step 8 — Start the stack

> All remaining steps in this guide assume your working directory is `/opt/omni/deploy`.

```bash
cd /opt/omni/deploy
docker compose build
docker compose up -d
```

Wait for all containers to be healthy. On a fresh install, the ENRS backend runs database migrations before starting — this takes 1–3 minutes. Subsequent starts (existing database) complete in under 30 seconds.

```bash
# Poll status — repeat until all show (healthy)
watch -n 5 docker compose ps
```

All services should show `(healthy)`. If any service stays unhealthy after 3 minutes:

```bash
docker compose logs <service-name>
```

**Expected startup order:** `postgres` → `redis` → `cc-backend` + `enrs-backend` (parallel, enrs runs migrations) → `cc-frontend` + `agent-desktop` + `enrs-frontend` → `nginx`

`nginx` only starts after all upstream containers are healthy — this is intentional.

---

### Step 9 — Run post-install

```bash
bash scripts/post-install.sh
```

This single command:
1. Waits for all backends to be healthy
2. Runs the CC database migration — **skipped automatically if schema already exists**
3. Seeds the CC initial user accounts (existing accounts are **never overwritten**)
4. Verifies ENRS auto-migration completed
5. Prints access URLs and credential reminders

> The script is safe to re-run. All steps check state before acting.

**Accounts created automatically on first run:**

| Application | Username / Email | Password | Role |
|-------------|-----------------|----------|------|
| ENRS | `INITIAL_ADMIN_EMAIL` from `.env` | `INITIAL_ADMIN_PASSWORD` from `.env` | SUPER_ADMIN |
| CC | `CC_INITIAL_ADMIN_USERNAME` from `.env` | `CC_INITIAL_ADMIN_PASSWORD` from `.env` | Admin |

> These accounts are created **only if no administrator exists** in that database. On subsequent deploys the bootstrap exits immediately — existing accounts are never modified.

> **Change all passwords immediately after first login** using each application's user management interface. Editing `.env` after the first boot has no effect on existing accounts.

---

### Step 10 — Run verification

```bash
bash scripts/verify-install.sh
```

Checks all components. All items should show `PASS`. Address any `FAIL` items before proceeding.

---

### Step 11 — Login

Open these URLs in a browser. Accept the self-signed certificate warning (Phase 1 only):

| Application | URL |
|-------------|-----|
| Contact Center | `https://<SERVER_NAME>/cc/` |
| Agent Desktop | `https://<SERVER_NAME>/agent/` |
| ENRS | `https://<SERVER_NAME>/enrs/` |

**ENRS credentials (first login):** email = `INITIAL_ADMIN_EMAIL`, password = `INITIAL_ADMIN_PASSWORD` from `deploy/.env`.

**CC credentials (first login):** username = `CC_INITIAL_ADMIN_USERNAME`, password = `CC_INITIAL_ADMIN_PASSWORD` from `deploy/.env`.

**Change all passwords immediately after first login** using each application's built-in user management. Editing `.env` after the first boot has no effect on existing accounts.

---

### Step 12 — Smoke Test

Manually verify each item. Mark PASS or FAIL.

#### Authentication
| Check | Expected | Result |
|-------|----------|--------|
| ENRS login at `/enrs/` | Dashboard loads | |
| CC login at `/cc/` | Dashboard loads | |
| Agent Desktop at `/agent/` | Login screen loads | |
| Bad password rejected | Error message shown | |
| Session persists on refresh | Still logged in | |

#### Contact Center
| Check | Expected | Result |
|-------|----------|--------|
| CC dashboard loads | No console errors | |
| Queue list visible | Data loads from API | |
| Agent list visible | Data loads from API | |
| WebSocket connected | No socket.io errors in console | |
| CC socket path | DevTools shows `/cc/socket.io` | |

#### ENRS
| Check | Expected | Result |
|-------|----------|--------|
| ENRS dashboard loads | No console errors | |
| ERS configuration list | Data loads | |
| ENS configuration list | Data loads | |
| IVR flow builder opens | Builder renders | |
| WebSocket connected | No socket.io errors in console | |
| ENRS socket path | DevTools shows `/enrs/socket.io` | |
| Tenant admin panel | Accessible as admin | |

#### Infrastructure
| Check | Expected | Result |
|-------|----------|--------|
| `docker compose ps` | All containers `(healthy)` | |
| PostgreSQL reachable | `docker compose exec postgres psql -U postgres -c "\l"` lists both DBs | |
| Redis responding | `docker compose exec redis redis-cli ping` returns `PONG` | |
| nginx serving HTTPS | Certificate shown in browser | |
| HTTP → HTTPS redirect | `http://SERVER_NAME/` redirects to `https://` | |
| Internal API blocked | `curl -sk https://SERVER_NAME/enrs/api/v1/internal/ers/lookup` returns `403` | |

#### FreeSWITCH Integration
| Check | Expected | Result |
|-------|----------|--------|
| ESL connected | `fs_cli -x "status"` shows UP | |
| FS_INTERNAL_KEY set | `fs_cli -x "global_getvar FS_INTERNAL_KEY"` returns value | |
| ENRS_API_URL set | `fs_cli -x "global_getvar ENRS_API_URL"` returns value | |

#### IVR / Audio
| Check | Expected | Result |
|-------|----------|--------|
| IVR flow publish | Flow publishes without error | |
| Dialplan deployment | Deploy button generates Lua scripts | |
| Lua scripts in FS_SCRIPT_DIR | `ls $FS_SCRIPT_DIR/*.lua` lists files | |
| Audio file upload | Upload completes in ENRS | |

#### Recording / Conference
| Check | Expected | Result |
|-------|----------|--------|
| Recording directory writable | `ls -la $FS_RECORDING_DIR` shows correct owner | |
| ERS test call | Conference bridge connects | |
| ENS test blast | Campaign creates in DB | |

---

## Backend Bootstrap Behaviour

Understanding how the backends start prevents confusion on first deployment.

### Startup sequence — both backends

Both the ENRS backend and the CC backend run an identical three-step sequence on every container start:

```
container start
      ↓
docker-entrypoint.sh runs
      ↓
  1. Database migration (idempotent — safe on every boot)
      ↓
  2. Administrator bootstrap (exits immediately if any admin already exists)
      ↓
  3. exec node server.js (application starts)
      ↓
healthcheck passes → container marked (healthy)
```

**Step-by-step:**

1. Docker starts the container and runs `docker-entrypoint.sh` as PID 1 (via tini).
2. The entrypoint runs migrations:
   - **Fresh database:** creates the full schema and applies all numbered migration files in order.
   - **Existing database:** skips already-applied files; applies only new ones.
3. If migration fails (database not reachable, SQL error), the container exits non-zero. Docker retries automatically — this is correct behaviour for a transient startup-order issue.
4. The entrypoint runs the admin bootstrap script:
   - **ENRS:** checks for an existing `SUPER_ADMIN` user. If none, creates one from `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD`. If one exists, exits 0 immediately.
   - **CC:** checks for an existing admin user. If none, creates one from `CC_INITIAL_ADMIN_USERNAME` / `CC_INITIAL_ADMIN_PASSWORD`. If one exists, exits 0 immediately.
5. `exec node server.js` — the application starts.

### Why the healthcheck start_period is 60 seconds

The first-boot migration applies the base schema and all migration files. On a production server this takes 20–60 seconds. The `start_period: 60s` means the healthcheck does not count failures during this window — the container is not marked unhealthy while migrations and bootstrap are running.

Subsequent restarts (existing database) skip all already-applied migrations and complete in ~2–5 seconds.

### Recovery from migration failure

If the ENRS backend is stuck restarting:

```bash
# See the actual migration error
docker compose logs enrs-backend | grep -i "migrat\|error\|fatal\|FATAL"

# Confirm postgres is healthy first
docker compose ps postgres

# Once the root cause is fixed, restart clears the loop automatically
# (Docker retries the entrypoint including migrate.js)
docker compose restart enrs-backend
```

---

## Phase 2: Domain + Real TLS Certificate

When DNS is pointed to this server:

### Let's Encrypt (certbot)

```bash
apt-get install -y certbot

# Stop nginx to free port 80
docker compose stop nginx

certbot certonly --standalone \
  --non-interactive --agree-tos \
  --email admin@company.com \
  -d omni.company.com

cp /etc/letsencrypt/live/omni.company.com/fullchain.pem deploy/ssl/
cp /etc/letsencrypt/live/omni.company.com/privkey.pem   deploy/ssl/
chmod 644 deploy/ssl/fullchain.pem
chmod 600 deploy/ssl/privkey.pem

# Only change needed in .env
sed -i 's/^SERVER_NAME=.*/SERVER_NAME=omni.company.com/' deploy/.env
sed -i 's/^SIP_DOMAIN=.*/SIP_DOMAIN=omni.company.com/' deploy/.env

docker compose up -d
```

**Auto-renewal** (`/etc/cron.d/omni-certbot`):

```
0 3 * * * root certbot renew --quiet \
  --pre-hook  "docker compose -f /opt/omni/deploy/docker-compose.yml stop nginx" \
  --post-hook "cp /etc/letsencrypt/live/omni.company.com/*.pem /opt/omni/deploy/ssl/ && docker compose -f /opt/omni/deploy/docker-compose.yml start nginx"
```

### Existing Certificate

```bash
cp /path/to/fullchain.pem deploy/ssl/
cp /path/to/privkey.pem   deploy/ssl/
chmod 644 deploy/ssl/fullchain.pem
chmod 600 deploy/ssl/privkey.pem
sed -i 's/^SERVER_NAME=.*/SERVER_NAME=omni.company.com/' deploy/.env
docker compose restart nginx
```

---

## Firewall

**Expose externally:**

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 5060/udp
ufw allow 5080/udp
ufw allow 16384:32768/udp
ufw enable
```

**Never expose:** ports 4000, 4100, 5432, 6379, 8021.

---

## Day-to-Day Operations

### Viewing logs

```bash
cd /opt/omni/deploy

# Tail all services
docker compose logs -f

# Tail one service
docker compose logs -f enrs-backend
docker compose logs -f cc-backend
docker compose logs -f nginx

# Last 200 lines only (no follow)
docker compose logs --tail=200 enrs-backend
```

---

### Restarting services safely

```bash
cd /opt/omni/deploy

# Restart one service (migrations + bootstrap run again — idempotent, safe)
docker compose restart enrs-backend
docker compose restart cc-backend

# Restart everything
docker compose restart
```

> Restarting the ENRS or CC backends does not create duplicate administrator accounts. Both bootstrap scripts check for an existing admin first and exit immediately if one is found.

---

### Stopping the system

```bash
cd /opt/omni/deploy

# Stop containers but keep data volumes intact
docker compose stop

# Stop AND remove containers (data volumes are preserved)
docker compose down
```

> `docker compose down` does NOT delete database data unless you add `--volumes`. Never add `--volumes` on a production system.

---

### Upgrading to a new release

1. Back up the database (see **Backup** below).
2. Pull the new release package into `/opt/omni`.
3. Review the release notes for any new required `.env` variables.
4. Add any new variables to `deploy/.env`.
5. Rebuild and restart:
   ```bash
   cd /opt/omni/deploy
   docker compose build
   docker compose up -d
   ```
6. New database migrations apply automatically on container startup (idempotent).
7. Run `bash scripts/post-install.sh` to confirm all services are healthy.

---

## Backup

See **[BACKUP_GUIDE.md](BACKUP_GUIDE.md)** for full backup and restore procedures.

**Minimum daily backup target:** the PostgreSQL data volume.

```bash
# Quick database backup (run on the server)
docker compose exec postgres pg_dumpall -U postgres > omni_backup_$(date +%Y%m%d).sql
```

Store backups off-server. The database volume path is `deploy/postgres/data/` by default.

---

## What NOT to Modify

| File / Directory | Why |
|---|---|
| `deploy/.env` | Contains all secrets. Never commit to git. Never share. |
| `deploy/ssl/privkey.pem` | TLS private key. Keep permissions at `600`. |
| `fs-enrs/` (application files) | Application source — changes belong in `fs-enrs` repository. |
| `fs-cc/` (application files) | Application source — changes belong in `fs-cc` repository. |
| `fs-enrs/backend/src/db/migrations/` | Database migrations are append-only. Never edit or delete existing migration files. |
| `fs-cc/backend/db/migrations/` | Same as above. |
| Container volumes | Do not delete Docker volumes while the system is running. |

---

## ⚠ Security Warnings

> **NEVER deploy with example or placeholder passwords.**
>
> Every value marked `(REQUIRED)` in `.env.example` must be replaced with a real secret before starting the system. The backend startup code contains guards that refuse to start if example values (`CHANGE_ME_*`, `CHANGE-IN-PRODUCTION`, `changeme`) are detected.
>
> **Never commit `deploy/.env` to any git repository.** The `.gitignore` already excludes it. Check before every `git add`.

---

## Known Limitations

| Item | Detail |
|---|---|
| ENRS request logging | Every request is logged to stdout — expected behaviour; adjust `LOG_LEVEL` in `.env` |
| Redis eviction | `allkeys-lru` can evict ENRS rate-limit counters under pressure |
| Let's Encrypt ACME | Use `--standalone` for initial issue; `--webroot -w deploy/ssl/acme` for renewals |
| Agent Desktop | Requires WebSocket connectivity — proxy/load-balancer must support WebSocket upgrades |
