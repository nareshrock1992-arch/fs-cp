# Omni Platform — Troubleshooting Guide

**Target OS:** Debian Bookworm (12)

---

## First: Collect Diagnostics

Before diagnosing any problem, collect this output:

```bash
cd /opt/omni/deploy

# Container status
docker compose ps

# Recent logs (all services)
docker compose logs --tail=50

# Full verification
bash deploy/scripts/verify-install.sh
```

---

## Container Problems

### Container won't start / exits immediately

```bash
docker compose logs <service>
```

**cc-backend exits with `FATAL: JWT_SECRET is not set`:**
- `CC_JWT_SECRET` in `.env` contains `CHANGE-IN-PRODUCTION`
- Fix: `CC_JWT_SECRET=$(openssl rand -hex 32)` — update `.env`, restart

**enrs-backend exits with `[validator] FATAL`:**
- One of the ENRS secrets is still a placeholder value
- The error message names the exact variable
- Fix: generate a real value with `openssl rand -hex 32`, update `.env`, restart

**enrs-backend exits with `DB_PASSWORD is set to an insecure default`:**
- `ENRS_DB_PASSWORD=changeme` in `.env`
- Fix: replace with `openssl rand -base64 24`

**Any backend exits with `ECONNREFUSED :5432`:**
- Postgres is not healthy yet — backends start before DB is ready
- Fix: `docker compose restart cc-backend enrs-backend` after postgres is healthy

### Container stays `unhealthy`

```bash
# Check healthcheck output (resolve container ID via compose — works regardless of container_name)
docker inspect --format='{{json .State.Health}}' \
  "$(docker compose ps -q cc-backend)" | python3 -m json.tool

# Check what the healthcheck is testing
docker compose exec cc-backend wget -qO- http://127.0.0.1:4000/api/health
docker compose exec enrs-backend wget -qO- http://127.0.0.1:4100/health/ready
```

**nginx stays unhealthy:**
- One of its dependencies (cc-backend, enrs-backend, frontends) is not healthy
- nginx health depends on all upstream containers first
- Fix: resolve the upstream container issue first

### `docker compose up -d` shows no output / hangs

```bash
docker compose up    # run in foreground to see output
```

---

## Database Problems

### CC backend: tables missing after startup

The CC migration does not run automatically. Run it manually:

```bash
bash deploy/scripts/post-install.sh
```

Or directly:

```bash
docker compose exec cc-backend node db/init.js
```

### ENRS backend: migration error on startup

The ENRS backend runs `migrate.js` automatically inside the container entrypoint before `server.js` starts. If the migration fails, the container exits and Docker retries it — the container will keep restarting until the migration succeeds or the root cause is fixed.

```bash
docker compose logs enrs-backend | grep -i "migrat\|error\|fatal"
```

Common causes:
- **PostgreSQL not ready** — `depends_on` ensures postgres is healthy before enrs-backend starts, but if the DB container was just created, allow 15–30 s for it to accept connections. Restart enrs-backend once postgres is confirmed healthy.
- **Wrong `ENRS_DB_PASSWORD`** — the password in `.env` does not match what postgres was initialized with. Verify `ENRS_DB_PASSWORD` matches in both the `postgres` and `enrs-backend` service sections.
- **First-time start takes longer than expected** — the `start_period` in docker-compose.yml is 120 s. On a fresh database, schema.sql plus all numbered migrations can take 30–60 s. Allow the full start_period before declaring it stuck.

To manually trigger a migration run (for debugging only — the entrypoint does this automatically on restart):

```bash
docker compose exec enrs-backend node src/db/migrate.js
```

### Cannot connect to PostgreSQL

```bash
# Test connection directly
docker compose exec postgres psql -U postgres -c "\l"

# Test from backend container
docker compose exec enrs-backend sh -c \
  "PGPASSWORD=\$DB_PASSWORD psql -h \$DB_HOST -U \$DB_USER -d \$DB_NAME -c '\conninfo'"
```

### PostgreSQL won't start

```bash
docker compose logs postgres
```

**`database system was shut down`** — normal message on clean start, not an error.

**`FATAL: password authentication failed`** — `POSTGRES_ADMIN_PASSWORD` changed after volume was initialized. Drop and recreate the volume (destroys all data):

```bash
docker compose down -v
docker compose up -d
bash deploy/scripts/post-install.sh
```

---

## Redis Problems

### Redis authentication error

```bash
docker compose logs redis
docker compose logs enrs-backend | grep -i redis
```

`WRONGPASS invalid username-password pair` — `REDIS_PASSWORD` in `.env` does not match the Redis password. Both values come from the same `REDIS_PASSWORD` variable in `.env` — if you see this, the volume was initialized with a different password.

Fix: stop redis, remove its volume, restart:

```bash
docker compose stop redis
docker volume rm omni_redis-data
docker compose up -d redis
docker compose restart enrs-backend
```

---

## nginx Problems

### nginx restart loop on startup

nginx enters a restart loop if any upstream dependency container is not healthy. The `depends_on` in `docker-compose.yml` gates nginx startup on all backends and frontends being healthy, so a loop here always means one of the upstreams is failing.

```bash
# Find the unhealthy upstream
docker compose ps

# Check the failing service
docker compose logs <unhealthy-service>
```

Resolve the upstream issue first, then nginx will start automatically once all upstreams are healthy.

**If nginx starts but immediately exits with a config error:**

```bash
docker compose logs nginx
```

Check for duplicate directive errors (e.g., `proxy_read_timeout` defined twice). The nginx configuration uses two proxy snippets:
- `snippets/proxy.conf` — included in all regular proxy location blocks (60 s read timeout)
- `snippets/socketio-proxy.conf` — included in Socket.IO location blocks only (3600 s read timeout, buffering off)

Any directive present in an included snippet must **not** be repeated inline in the same location block.

### 502 Bad Gateway

nginx cannot reach a backend container. Check:

```bash
# Is the backend healthy?
docker compose ps cc-backend enrs-backend

# Can nginx reach the backend?
docker compose exec nginx wget -qO- http://cc-backend:4000/api/health
docker compose exec nginx wget -qO- http://enrs-backend:4100/api/health
```

### 404 on all paths

nginx is serving but routing is wrong. Check the template substitution:

```bash
docker compose exec nginx cat /etc/nginx/conf.d/omni.conf
```

If `${SERVER_NAME}` appears literally, envsubst did not run. Verify `SERVER_NAME` is set in `.env` and restart nginx.

### SSL certificate error in browser

**"Your connection is not private"** — Expected for self-signed certificates. Click Advanced → Proceed.

**"SSL_ERROR_RX_RECORD_TOO_LONG"** — Connecting to the HTTP port with HTTPS. Ensure you are using `https://`, not `http://`.

**Certificate expired:**
```bash
openssl x509 -enddate -noout -in deploy/ssl/fullchain.pem
# Renew: bash deploy/scripts/generate-self-signed.sh
```

### nginx won't serve HTTPS

Check certificate files exist and are readable:

```bash
ls -la deploy/ssl/fullchain.pem deploy/ssl/privkey.pem
docker compose exec nginx openssl x509 -noout -subject -in /etc/nginx/ssl/fullchain.pem
```

---

## FreeSWITCH ESL Problems

### Backends log "ESL connection refused" or "ECONNREFUSED"

The backends connect to FreeSWITCH ESL at `host.docker.internal:8021`.

```bash
# Is FreeSWITCH running?
systemctl status freeswitch

# Is ESL listening?
ss -tlnp | grep 8021

# Can a container reach it?
docker compose exec enrs-backend sh -c \
  "nc -z host.docker.internal 8021 && echo REACHABLE || echo BLOCKED"
```

**FreeSWITCH is listening but containers can't reach it:**

ESL is bound to `127.0.0.1` — Docker containers cannot reach this via `host.docker.internal`.

Fix: change `listen-ip` to `0.0.0.0` in `event_socket.conf.xml`, then restrict with ACL:

```xml
<param name="listen-ip" value="0.0.0.0"/>
<param name="apply-inbound-acl" value="loopback.auto"/>
```

After editing, restart FreeSWITCH: `systemctl restart freeswitch`

Also add a firewall rule to allow the Docker bridge:

```bash
ufw allow from 172.30.0.0/24 to any port 8021
```

**`host.docker.internal` not resolving:**

On Docker Engine < 20 or without Docker Desktop, `host.docker.internal` may not be set. Use the gateway IP instead:

```bash
# Find the Docker bridge gateway
docker network inspect omni_omni-net | grep Gateway
```

Set `FS_ESL_HOST=<that IP>` in `.env` and restart backends.

### Wrong ESL password

```bash
docker compose logs enrs-backend | grep -i "esl\|password\|auth"
```

If you see auth failures, `FS_ESL_PASSWORD` in `.env` does not match FreeSWITCH. Run:

```bash
sudo bash deploy/scripts/prepare-freeswitch.sh
docker compose restart cc-backend enrs-backend
```

### Lua scripts not calling backend

```bash
# Check Lua variables in FreeSWITCH
fs_cli -x "global_getvar FS_INTERNAL_KEY"
fs_cli -x "global_getvar ENRS_API_URL"
```

If blank or showing placeholder values:

```bash
sudo bash deploy/scripts/prepare-freeswitch.sh
fs_cli -x "reloadxml"
```

---

## Socket.IO Problems

### WebSocket not connecting (browser console errors)

Check the socket path. DevTools → Network → WS tab:
- CC frontend must connect to `/cc/socket.io`
- ENRS frontend must connect to `/enrs/socket.io`

If connecting to `/socket.io` (without prefix), the frontend image was built without the correct `VITE_SOCKET_PATH` build arg. Rebuild the image.

Check nginx WebSocket proxying:

```bash
docker compose exec nginx cat /etc/nginx/conf.d/omni.conf | grep -A5 socket.io
```

### Socket connects then immediately disconnects

```bash
docker compose logs cc-backend   | grep -i "socket\|cors"
docker compose logs enrs-backend | grep -i "socket\|cors"
```

CORS error — `CORS_ORIGIN` (constructed from `SERVER_NAME` in compose) does not match the browser's origin. Verify `SERVER_NAME` matches the URL you're using in the browser.

---

## IVR / Deployment Problems

### IVR publish fails

```bash
docker compose logs enrs-backend | grep -i "ivr\|error\|valid"
```

Common: ERS or ENS configuration ID in the IVR flow belongs to a different tenant. Each node's configuration must match the flow's tenant.

### Dialplan deployment fails

The backend writes files to `FS_CONF_DIR`, `FS_DIALPLAN_DIR`, and `FS_SCRIPT_DIR` (mounted as volumes). Check:

```bash
# Can the container write to these paths?
docker compose exec enrs-backend sh -c "touch $FS_SCRIPT_DIR/test.tmp && echo OK || echo FAIL"
docker compose exec enrs-backend sh -c "rm -f $FS_SCRIPT_DIR/test.tmp"
```

If `FAIL`, the directory permissions are wrong. Fix:

```bash
FS_SCRIPT_DIR=$(grep '^FS_SCRIPT_DIR=' deploy/.env | cut -d= -f2)
sudo chown -R 1000:1000 "${FS_SCRIPT_DIR}"
```

### Lua scripts deployed but FreeSWITCH doesn't use them

FreeSWITCH must reload after deployment:

```bash
fs_cli -x "reloadxml"
fs_cli -x "reload mod_lua"
```

---

## Audio / Recording Problems

### Recordings not being created

```bash
FS_RECORDING_DIR=$(grep '^FS_RECORDING_DIR=' deploy/.env | cut -d= -f2)
ls -la "${FS_RECORDING_DIR}"
```

FreeSWITCH must be able to write to this directory:

```bash
FS_USER=$(ps aux | grep freeswitch | grep -v grep | awk '{print $1}' | head -1)
sudo chown -R "${FS_USER}:${FS_USER}" "${FS_RECORDING_DIR}"
```

### Audio upload fails in ENRS

```bash
docker compose logs enrs-backend | grep -i "upload\|multer\|size"
```

`File too large` — increase `UPLOAD_MAX_MB` in `.env` and restart enrs-backend.

Permission error — `deploy/uploads/enrs/` is not writable by the container:

```bash
sudo chown -R 1000:1000 deploy/uploads/
```

---

## General Debugging Commands

```bash
# Container inspect (resolve via compose to avoid guessing the container name)
docker inspect "$(docker compose ps -q enrs-backend)"

# Container environment variables
docker compose exec enrs-backend env | sort

# Network connectivity between containers
docker compose exec enrs-backend ping postgres
docker compose exec enrs-backend ping redis

# Database connectivity test
docker compose exec enrs-backend sh -c \
  "PGPASSWORD=\$DB_PASSWORD psql -h \$DB_HOST -U \$DB_USER -d \$DB_NAME -c 'SELECT 1'"

# Redis connectivity test
docker compose exec enrs-backend sh -c \
  "redis-cli -h \$REDIS_HOST -p \$REDIS_PORT -a \$REDIS_PASSWORD ping"

# Clean up and restart from scratch (WARNING: destroys all data)
docker compose down -v
docker compose up -d
bash deploy/scripts/post-install.sh
```
