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
| `SEED_ADMIN_PASSWORD` | Strong password for ENRS admin |
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

```bash
cd /opt/omni/deploy
docker compose build
docker compose up -d
```

Wait for all containers to be healthy (~60 seconds):

```bash
docker compose ps
```

All services should show `(healthy)`. If any service stays unhealthy:

```bash
docker compose logs <service-name>
```

---

### Step 9 — Run post-install

```bash
bash deploy/scripts/post-install.sh
```

Runs the Contact Center database migration (`node db/init.js`) and verifies ENRS auto-migration.

> **Run once only.** The CC migration cannot be repeated without dropping the database. If it fails, check `docker compose logs cc-backend`.

---

### Step 10 — Run verification

```bash
bash deploy/scripts/verify-install.sh
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

ENRS admin credentials: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `deploy/.env`.

**Change the ENRS admin password immediately after first login.**

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

## Known Limitations

| Item | Detail |
|------|--------|
| CC migration is once-only | `node db/init.js` cannot be re-run without dropping the DB |
| ENRS request logging | Every request logged to stdout — hardcoded in `server.js` |
| Redis eviction | `allkeys-lru` can evict ENRS rate-limit counters under pressure |
| Let's Encrypt ACME | Use `--standalone` for initial issue; `--webroot -w deploy/ssl/acme` for renewals |
