# DEPLOYMENT-GUIDE.md — Omni Platform

**Audience:** System administrator or IT operator. No developer knowledge required.
**Last updated:** 2026-08-21
**Repository:** `fs-cp`

---

## What you are deploying

The Omni Platform consists of two applications that run together in Docker containers:

| Application | What it does | URL after deploy |
|---|---|---|
| **ENRS** (Emergency Notification & Response System) | Emergency notifications, conference bridges, IVR | `https://SERVER/enrs/` |
| **CC** (Contact Center) | Agent management, call queue, reporting | `https://SERVER/cc/` |
| **Agent Desktop** | Agent softphone interface | `https://SERVER/agent/` |
| **Dashboard** | Entry page with links to both apps | `https://SERVER/` |

FreeSWITCH (the telephony engine) runs on the **host server**, not in Docker. The platform connects to it automatically.

---

## A. PRE-DEPLOYMENT CHECKLIST

### Server requirements

| Item | Minimum | Recommended |
|---|---|---|
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Disk | 50 GB free | 200 GB free (recordings grow) |
| Docker | 24.x | Latest stable |
| Docker Compose | v2.20+ (plugin, not standalone) | Latest stable |
| FreeSWITCH | 1.10.x installed and running | 1.10.x |
| Network | Port 80 and 443 open | + firewall configured |

### Verify Docker is installed

```bash
docker --version
docker compose version
```

Expected output example:
```
Docker version 25.0.3, build 4debf41
Docker Compose version v2.24.5
```

If `docker compose` is not found, install the Docker Compose plugin:
```bash
apt-get install docker-compose-plugin
```

### Verify FreeSWITCH is running

```bash
fs_cli -x "status"
```

FreeSWITCH must be running before you configure its integration. If `fs_cli` is not found, FreeSWITCH is not installed.

### Check disk space

```bash
df -h /
```

Ensure at least 50 GB free before building Docker images.

---

## B. DIRECTORY STRUCTURE

Place the repository on the server. All commands in this guide are run from inside the `deploy/` directory unless stated otherwise.

```
/opt/omni/                  ← recommended installation path
└── fs-cp/                  ← git repository root
    ├── deploy/             ← *** ALL COMMANDS RUN FROM HERE ***
    │   ├── docker-compose.yml
    │   ├── .env            ← you create this (never commit to git)
    │   ├── .env.example    ← template to copy from
    │   ├── nginx/
    │   ├── postgres/
    │   ├── scripts/        ← helper scripts (prepare-*, generate-*, verify-*)
    │   ├── ssl/            ← TLS certificates go here
    │   ├── logs/           ← container log output
    │   └── uploads/        ← user-uploaded files
    ├── fs-enrs/            ← ENRS application code (do not edit)
    └── fs-cc/              ← CC application code (do not edit)
```

FreeSWITCH directories (on the host, default compiled-to-/opt/freeswitch):
```
/opt/freeswitch/etc/freeswitch/          ← FS_CONF_DIR
/opt/freeswitch/share/freeswitch/scripts ← FS_SCRIPT_DIR (Lua scripts)
/opt/freeswitch/var/lib/freeswitch/recordings ← FS_RECORDING_DIR
```

If your FreeSWITCH was installed from Debian/Ubuntu packages, the paths are different — see the `.env` file for the package-install defaults.

---

## C. ENVIRONMENT CONFIGURATION

### Step 1 — Copy the template

```bash
cd /opt/omni/fs-cp/deploy
cp .env.example .env
```

### Step 2 — Edit the file

```bash
nano .env
```

Every value marked `(REQUIRED)` **must** be changed. Using placeholder values will cause services to refuse to start.

### Required values — what to set

**SERVER IDENTITY**

| Variable | What to put | Example |
|---|---|---|
| `SERVER_NAME` | Server IP or domain name | `192.168.1.100` or `omni.company.com` |
| `SERVER_IP` | Server IP (used by scripts only) | `192.168.1.100` |
| `SIP_DOMAIN` | Same IP or domain (used in SIP addresses) | `192.168.1.100` |

**PASSWORDS — generate strong random values**

```bash
openssl rand -base64 24    # for passwords
openssl rand -hex 32       # for JWT secrets and API keys
```

| Variable | What to put |
|---|---|
| `POSTGRES_ADMIN_PASSWORD` | Strong random password |
| `CC_DB_PASSWORD` | Strong random password |
| `ENRS_DB_PASSWORD` | Strong random password (cannot be "changeme") |
| `REDIS_PASSWORD` | Strong random password |
| `FS_ESL_PASSWORD` | Your FreeSWITCH ESL password (default is "ClueCon" — change it) |
| `CC_JWT_SECRET` | 64-character random hex (`openssl rand -hex 32`) |
| `JWT_ACCESS_SECRET` | 64-character random hex |
| `JWT_REFRESH_SECRET` | 64-character random hex (different from ACCESS) |
| `INTERNAL_API_KEY` | 64-character random hex |

**ADMIN ACCOUNTS — first-boot only**

| Variable | What to put |
|---|---|
| `INITIAL_ADMIN_EMAIL` | Email for the ENRS admin account |
| `INITIAL_ADMIN_PASSWORD` | Password (8+ chars, mixed case + digit + special) |
| `INITIAL_ADMIN_NAME` | Display name (default: System Administrator) |
| `CC_INITIAL_ADMIN_USERNAME` | Username for CC admin (letters/numbers/dots/hyphens) |
| `CC_INITIAL_ADMIN_PASSWORD` | Password for CC admin (8+ chars) |

These are only used once — on the very first container start. After the accounts are created, you can remove or leave these variables; they will be ignored.

**FREESWITCH PATHS**

The defaults in `.env` assume FreeSWITCH was compiled and installed to `/opt/freeswitch`. If yours is installed from a Debian/Ubuntu package, update these paths to the commented package defaults in the `.env` file.

Verify your paths:
```bash
fs_cli -x "global_getvar conf_dir"
fs_cli -x "global_getvar scripts_dir"
fs_cli -x "global_getvar recordings_dir"
```

**Do NOT change** routing variables (`CC_BASE_PATH`, `ENRS_BASE_PATH`, etc.) unless you also rebuild Docker images.

---

## D. PRE-DEPLOYMENT VALIDATION

Run these checks before starting containers.

### Check environment file

```bash
cd /opt/omni/fs-cp/deploy
grep -E "CHANGE_ME|changeme|CHANGE-IN-PRODUCTION|REPLACE_WITH" .env
```

**Expected:** no output. If any placeholder values appear, replace them before continuing.

### Check Docker Compose configuration

```bash
cd /opt/omni/fs-cp/deploy
docker compose config --quiet
echo "Exit code: $?"
```

**Expected:** exit code `0` with no error messages. Any errors indicate a problem with `.env` or `docker-compose.yml`.

### Run the validation script

```bash
cd /opt/omni/fs-cp/deploy
bash scripts/validate-runtime-dependencies.sh
```

This checks FreeSWITCH connectivity, required modules, Docker, and other dependencies before you start.

---

## E. FREESWITCH PERMISSIONS AND INTEGRATION

This section must be done **before** starting Docker containers.

### Step 1 — Create required directories

```bash
cd /opt/omni/fs-cp/deploy
sudo bash scripts/prepare-directories.sh
```

This script:
- Creates all FreeSWITCH directories listed in `.env` if they do not exist
- Creates application log and upload directories (`deploy/logs/`, `deploy/uploads/`)
- Sets correct ownership (`uid 1000` for application directories, FreeSWITCH user for FS directories)

**Required permissions for container write access:**

The backend containers run as `node` user (uid 1000). These host directories must be writable by uid 1000:
- `deploy/logs/cc/` — CC backend logs
- `deploy/logs/enrs/` — ENRS backend logs
- `deploy/uploads/cc/` — CC user uploads
- `deploy/uploads/enrs/` — ENRS user uploads

The script sets this automatically. If you create these directories manually, run:
```bash
chown -R 1000:1000 /opt/omni/fs-cp/deploy/logs /opt/omni/fs-cp/deploy/uploads
```

FreeSWITCH directories must be writable by FreeSWITCH (and by the backend containers that write recordings):
- `FS_RECORDING_DIR` — ENRS and CC write call recordings here
- `FS_STORAGE_DIR` — media storage
- `FS_SCRIPT_DIR` — ENRS deployment engine writes Lua scripts here

The backend containers also run as uid 1000 and need write access to these host FS directories. The minimum safe setup:
```bash
# If FreeSWITCH runs as the 'freeswitch' user:
chown freeswitch:freeswitch /opt/freeswitch/var/lib/freeswitch/recordings
chmod 775 /opt/freeswitch/var/lib/freeswitch/recordings
# Add uid 1000 to the freeswitch group, OR:
setfacl -m u:1000:rwx /opt/freeswitch/var/lib/freeswitch/recordings

# If FreeSWITCH runs as root (compiled installs):
chmod 777 /opt/freeswitch/var/lib/freeswitch/recordings  # only if no other option
```

The `prepare-directories.sh` script will warn you if directories are not writable.

### Step 2 — Configure FreeSWITCH integration

```bash
cd /opt/omni/fs-cp/deploy
sudo bash scripts/prepare-freeswitch.sh
```

This script:
- Updates `event_socket.conf.xml` with `FS_ESL_PASSWORD` from `.env`
- Writes `FS_INTERNAL_KEY` and `ENRS_API_URL` into FreeSWITCH `vars.xml`
- Reloads FreeSWITCH configuration if it is running

**This script will fail and refuse to continue** if `FS_ESL_PASSWORD` is still `CHANGE_ME_esl_password`. Set the real value in `.env` first.

After running, verify:
```bash
fs_cli -x "global_getvar FS_INTERNAL_KEY"
fs_cli -x "global_getvar ENRS_API_URL"
```

Both must return non-empty values.

### Step 3 — Generate TLS certificate (first deploy only)

If you do not have a TLS certificate, generate a self-signed one:
```bash
cd /opt/omni/fs-cp/deploy
sudo bash scripts/generate-self-signed.sh
```

This creates `deploy/ssl/fullchain.pem` and `deploy/ssl/privkey.pem`.

> **Note:** Browsers will show a security warning with self-signed certificates. This is expected. To use a Let's Encrypt certificate, see the nginx configuration comments.

---

## F. DATABASE

**You do not need to run any SQL commands manually.** Database creation and migration happen automatically.

### What happens automatically

```
Server starts
    ↓
PostgreSQL container starts
    ↓
PostgreSQL healthcheck passes (30–60 seconds)
    ↓
Backend containers start
    ↓
Migration runner executes (acquires PostgreSQL advisory lock)
    ↓
  Fresh install: creates all tables, indexes, and constraints
  Existing install: applies only new migrations, skips existing ones
    ↓
Migration completes successfully
    ↓
Admin seed runs (creates admin account if none exists)
    ↓
Application server starts
    ↓
Healthcheck passes
    ↓
Nginx starts and begins accepting traffic
```

This sequence is the same for both ENRS and CC. Neither application accepts traffic until its database is ready.

### Fresh database vs. upgrade

- **First deployment (empty database):** All tables and initial data are created automatically. Takes 10–30 seconds.
- **Upgrade (existing database):** Only new migrations run. Takes 2–5 seconds.

Both are handled automatically — no manual action required.

### Database confirmation

After containers start, confirm migrations ran:

```bash
# Check CC migrations
docker compose exec postgres psql -U fs_cc_user -d fs_cc \
  -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"

# Check ENRS migrations
docker compose exec postgres psql -U fs_enrs_user -d fs_enrs \
  -c "SELECT migration_name, applied_at FROM schema_migrations ORDER BY migration_name;"
```

Expected: a list of migration names with timestamps. If no rows appear, migrations did not run — check `docker compose logs cc-backend` or `docker compose logs enrs-backend`.

**Do not manually run migration SQL files during normal deployment.**

---

## G. DEPLOYMENT

All commands run from `deploy/`:

```bash
cd /opt/omni/fs-cp/deploy
```

### Build all Docker images

```bash
docker compose build
```

This builds 7 images. Expected time: 5–15 minutes depending on network speed. On subsequent builds with unchanged code, most layers are cached and it takes 1–2 minutes.

### Start all services

```bash
docker compose up -d
```

This starts PostgreSQL, Redis, both backends, both frontends, the agent desktop, and nginx.

> **Important:** Do not proceed to verification until all containers report as **healthy**. This takes up to 3 minutes on first start (migrations running).

---

## H. VERIFY DEPLOYMENT

### Check container status

```bash
docker compose ps
```

All containers should show `healthy` status. While starting, they show `starting`. A container showing `unhealthy` or `restarting` indicates a problem — check logs immediately.

Expected healthy output:
```
NAME                  SERVICE         STATUS     PORTS
omni-postgres         postgres        healthy    5432/tcp
omni-redis            redis           healthy    6379/tcp
omni-cc-backend       cc-backend      healthy    127.0.0.1:4000->4000/tcp
omni-enrs-backend     enrs-backend    healthy    127.0.0.1:4100->4100/tcp
omni-cc-frontend      cc-frontend     healthy
omni-agent-desktop    agent-desktop   healthy
omni-enrs-frontend    enrs-frontend   healthy
omni-nginx            nginx           healthy    0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
```

### Check application health endpoints

```bash
# CC backend health
curl -sk https://localhost/cc/api/health
# Expected: {"status":"ok"} or similar

# ENRS backend health
curl -sk https://localhost/enrs/health/ready
# Expected: {"status":"ready"} or similar
```

(`-sk` skips TLS verification for self-signed certificates)

### Run the full verification script

```bash
bash scripts/verify-install.sh
```

This runs 10+ checks including container health, routing, TLS, PostgreSQL table counts, Redis, ESL port, and Lua scripts.

### Application URLs

Open a browser and navigate to:

| URL | Application |
|---|---|
| `https://SERVER_NAME/` | Dashboard (links to all apps) |
| `https://SERVER_NAME/enrs/` | ENRS login |
| `https://SERVER_NAME/cc/` | Contact Center login |
| `https://SERVER_NAME/agent/` | Agent Desktop |

Where `SERVER_NAME` is the value you set in `.env`.

---

## I. FIRST LOGIN

### ENRS (Emergency Notification & Response System)
- URL: `https://SERVER_NAME/enrs/`
- Username: the email you set in `INITIAL_ADMIN_EMAIL`
- Password: the value you set in `INITIAL_ADMIN_PASSWORD`
- **Change your password immediately after first login.**

### CC (Contact Center)
- URL: `https://SERVER_NAME/cc/`
- Username: the value you set in `CC_INITIAL_ADMIN_USERNAME`
- Password: the value you set in `CC_INITIAL_ADMIN_PASSWORD`
- **Change your password immediately after first login.**

---

## J. ROLLBACK

### Rolling back to the previous image version

If a new deployment introduces a problem, roll back images without touching the database:

```bash
cd /opt/omni/fs-cp/deploy

# Edit .env — change image tags back to the previous version
# e.g. CC_BACKEND_IMAGE=omni/cc-backend:0.9.0
nano .env

# Restart with previous images
docker compose up -d
```

> **Important:** Rolling back images does NOT revert the database. If a new migration was applied, rolling back the image may leave the database in a newer state than the code expects. Only roll back if you have NOT run database migrations in the new version.

### Rolling back after a failed migration

If a migration fails mid-way:
1. Do NOT delete any volumes.
2. Check `docker compose logs cc-backend` or `docker compose logs enrs-backend` for the exact SQL error.
3. The failed migration was rolled back automatically (transactions) — the database is consistent.
4. Fix the migration SQL in the development repository, sync to fs-cp, rebuild, and redeploy.

### What survives a rollback

| Data | Survives container stop/restart | Survives `docker compose down` | Survives `docker compose down -v` |
|---|---|---|---|
| Database (ENRS + CC) | ✅ Yes | ✅ Yes | ❌ DELETED — do not use |
| Recordings | ✅ Yes (host FS dir) | ✅ Yes | ✅ Yes (host bind mount) |
| Uploads | ✅ Yes (host bind mount) | ✅ Yes | ✅ Yes |
| Redis session data | ✅ Yes | ✅ Yes | ❌ DELETED — sessions expire |

**Never use `docker compose down -v` in production.** This deletes the PostgreSQL data volume and destroys all databases. Use `docker compose down` (without `-v`) instead.

---

## K. TROUBLESHOOTING

### Container not starting / restarting

```bash
docker compose ps                      # see which container is unhealthy
docker compose logs cc-backend         # replace with the failing service name
docker compose logs enrs-backend
```

Look for `ERROR`, `FATAL`, or `Migration failed` in the output.

---

### Database connection refused

**Symptom:** Backend logs show `ECONNREFUSED` or `connection refused to postgres:5432`.

**Check:**
```bash
docker compose ps postgres
```

**Expected:** `healthy`. If it shows `starting`, wait 30 seconds and check again. If it shows `unhealthy`:
```bash
docker compose logs postgres
```

**Common cause:** Wrong `POSTGRES_ADMIN_PASSWORD` or `POSTGRES_PORT` in `.env`.

---

### Migration failed

**Symptom:** Backend logs contain `Migration failed` or `relation already exists`.

**Action:**
1. Note the exact migration name from the log.
2. Do NOT delete the database.
3. Contact the development team with the full log output.
4. The migration was rolled back — the database is safe to restart.

---

### Backend healthcheck failing (unhealthy)

**Symptom:** `docker compose ps` shows `cc-backend` or `enrs-backend` as `unhealthy`.

**Check:**
```bash
docker compose logs --tail=50 cc-backend
docker compose logs --tail=50 enrs-backend
```

**Common causes:**
- Database migration still running (wait 2 more minutes, then recheck)
- Wrong JWT secret in `.env` (look for "server refuses to start" in log)
- Wrong `ENRS_DB_PASSWORD` set to `changeme` (ENRS checks this)

---

### Nginx 502 Bad Gateway

**Symptom:** Browser shows `502 Bad Gateway` when accessing the app URLs.

**Check:**
```bash
docker compose ps                  # all backends and frontends must be healthy
docker compose logs nginx          # check for upstream errors
```

Nginx only starts after all backends and frontends are healthy. If a backend is still starting, Nginx waits. If a backend stays unhealthy, fix the backend issue first.

---

### FreeSWITCH ESL connection failure

**Symptom:** Backend logs show `ESL connection failed` or `ECONNREFUSED host.docker.internal:8021`.

**Check:**
```bash
# On the host server
netstat -tlnp | grep 8021         # port must be listening
fs_cli -x "status"                # FreeSWITCH must be running
```

**Common causes:**
- FreeSWITCH is not running (`service freeswitch start`)
- `event_socket.conf.xml` has a different password than `FS_ESL_PASSWORD` in `.env`
- FreeSWITCH ESL is not listening on `127.0.0.1` or `0.0.0.0`

**Fix:**
```bash
cd /opt/omni/fs-cp/deploy
sudo bash scripts/prepare-freeswitch.sh
```

---

### Port 80 or 443 already in use

**Symptom:** `docker compose up` fails with `Bind for 0.0.0.0:80 failed: port is already allocated`.

**Check:**
```bash
netstat -tlnp | grep ':80\|:443'
```

Another web server (Apache, nginx on host) is using the port. Stop it first:
```bash
systemctl stop nginx apache2      # whichever is running
```

---

### Admin account not created (cannot log in)

**Symptom:** ENRS or CC login fails even with the correct credentials you set in `.env`.

**Check:**
```bash
docker compose logs enrs-backend | grep "seed\|admin\|bootstrap"
docker compose logs cc-backend   | grep "seed\|admin\|bootstrap"
```

**Expected:** Lines like `[seed] admin created` or `[seed] admin already exists — skipping`.

**If you see "INITIAL_ADMIN_EMAIL not set" or similar:**

Your `.env` has wrong variable names. Verify `.env` contains:
- `INITIAL_ADMIN_EMAIL=` (not `SEED_ADMIN_EMAIL`)
- `CC_INITIAL_ADMIN_USERNAME=` (not `CC_ADMIN_USERNAME` or `CC_ADMIN_PASSWORD`)

Fix `.env`, then restart:
```bash
docker compose restart enrs-backend cc-backend
```

The seed script runs again on restart and creates the account if it does not exist.

---

### Permission denied on FreeSWITCH directories

**Symptom:** ENRS backend logs show `EACCES: permission denied` for recording or script directories.

**Fix:**
```bash
# Check which directory is failing from the log, then:
chown -R 1000:1000 /path/to/failing/directory
# OR (if FreeSWITCH owns the directory):
setfacl -m u:1000:rwx /path/to/failing/directory
```

---

## L. POST-DEPLOYMENT CHECKLIST

Complete this after the deployment is verified as running.

- [ ] All 8 containers show `healthy` in `docker compose ps`
- [ ] `https://SERVER_NAME/enrs/` — login with ENRS admin account works
- [ ] `https://SERVER_NAME/cc/` — login with CC admin account works
- [ ] `https://SERVER_NAME/agent/` — agent desktop loads
- [ ] Change ENRS admin password from the default
- [ ] Change CC admin password from the default
- [ ] `curl -sk https://SERVER_NAME/cc/api/health` returns success response
- [ ] `curl -sk https://SERVER_NAME/enrs/health/ready` returns success response
- [ ] FreeSWITCH ESL connected — check ENRS dashboard or logs for "ESL connected"
- [ ] SIP extension registers successfully (test phone or SIP client)
- [ ] Test ENS call: trigger a broadcast from ENRS, verify call reaches a phone
- [ ] Test ERS conference: dial the emergency number, verify bridge works
- [ ] Test IVR: dial an IVR number, verify menu plays
- [ ] Test CC: agent logs in to Agent Desktop, accepts a test call
- [ ] Verify recordings appear in `FS_RECORDING_DIR` after test calls
- [ ] Run `bash scripts/validate-deployment.sh` — all checks should pass
- [ ] Run `bash scripts/verify-install.sh` — all checks should pass

---

## UPGRADE PROCEDURE

To upgrade to a newer version:

```bash
cd /opt/omni/fs-cp

# Pull latest code
git pull

# Navigate to deploy
cd deploy

# Rebuild images
docker compose build

# Restart with new images
docker compose up -d

# New migrations run automatically — monitor logs
docker compose logs -f enrs-backend cc-backend
```

Wait for "all migrations complete" in the logs before considering the upgrade done.

---

## QUICK REFERENCE — COMMON COMMANDS

```bash
# All commands run from deploy/ directory
cd /opt/omni/fs-cp/deploy

# Status
docker compose ps

# Logs (follow)
docker compose logs -f enrs-backend
docker compose logs -f cc-backend
docker compose logs -f nginx

# Restart one service
docker compose restart cc-backend

# Restart all services
docker compose restart

# Stop everything (keeps data)
docker compose down

# Rebuild and restart
docker compose build && docker compose up -d

# Check a health endpoint manually
curl -sk https://localhost/enrs/health/ready
curl -sk https://localhost/cc/api/health
```
