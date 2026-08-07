# Omni Platform — Operations Guide

**Target OS:** Debian Bookworm (12)

---

## Daily Operations

### Check platform status

```bash
cd /opt/omni/deploy
docker compose ps
```

All containers should show `(healthy)`. If any container is unhealthy:

```bash
docker compose logs --tail=50 <service>
```

Services: `postgres`, `redis`, `cc-backend`, `enrs-backend`, `cc-frontend`, `agent-desktop`, `enrs-frontend`, `nginx`

### View logs

```bash
# All services (live)
docker compose logs -f

# One service
docker compose logs -f enrs-backend

# Last 100 lines
docker compose logs --tail=100 nginx

# Since a specific time
docker compose logs --since 1h cc-backend
```

### Run full verification

```bash
bash deploy/scripts/verify-install.sh
```

---

## Start / Stop / Restart

```bash
# Start all
docker compose up -d

# Stop all (volumes preserved)
docker compose stop

# Restart all
docker compose down && docker compose up -d

# Restart one service (e.g. after config change)
docker compose restart nginx
docker compose restart enrs-backend

# Restart without downtime (for stateless services)
docker compose up -d --no-deps --force-recreate cc-frontend
```

---

## Container Shell Access

```bash
# Backend shell
docker compose exec cc-backend   sh
docker compose exec enrs-backend sh

# Database shell
docker compose exec postgres psql -U postgres

# Connect to a specific database
docker compose exec postgres psql -U postgres -d fs_cc
docker compose exec postgres psql -U postgres -d fs_enrs

# Redis shell
docker compose exec redis redis-cli
```

---

## Configuration Changes

### Change SERVER_NAME (domain migration)

Edit `.env`:
```bash
nano deploy/.env
# Set: SERVER_NAME=omni.company.com
# Set: SIP_DOMAIN=omni.company.com
```

Copy new certificate to `deploy/ssl/`, then:
```bash
docker compose restart nginx
```

No other containers need restarting — only nginx reads `SERVER_NAME` at runtime.

### Change any other .env variable

After editing `.env`, restart the affected service:

```bash
docker compose up -d --no-deps <service-name>
```

Services affected by each variable:

| Variable group | Service to restart |
|---------------|-------------------|
| `CC_JWT_*`, `CC_DB_*` | `cc-backend` |
| `JWT_*`, `ENRS_DB_*`, `INTERNAL_API_KEY`, `ESL_*` | `enrs-backend` |
| `REDIS_*` | `enrs-backend` |
| `POSTGRES_*` | Requires `postgres` restart — wait for healthy then restart backends |
| `SSL_CERT`, `SSL_KEY`, `SERVER_NAME` | `nginx` |
| `FS_ESL_PASSWORD` | `prepare-freeswitch.sh` + `enrs-backend` + `cc-backend` |

### Change FreeSWITCH ESL password

1. Update `FS_ESL_PASSWORD` in `.env`
2. Run: `sudo bash deploy/scripts/prepare-freeswitch.sh`
3. Restart backends: `docker compose restart cc-backend enrs-backend`

### Change INTERNAL_API_KEY

1. Update `INTERNAL_API_KEY` in `.env`
2. Run: `sudo bash deploy/scripts/prepare-freeswitch.sh` (updates vars.xml)
3. Restart: `docker compose restart enrs-backend`
4. Reload FreeSWITCH: `fs_cli -x "reloadxml"`

---

## FreeSWITCH Operations

### Check FreeSWITCH status

```bash
fs_cli -x "status"
fs_cli -x "show channels"
fs_cli -x "show calls"
```

### Reload FreeSWITCH dialplan

```bash
fs_cli -x "reloadxml"
```

### Reload a specific module

```bash
fs_cli -x "reload mod_event_socket"
fs_cli -x "reload mod_lua"
```

### Check ESL connection from containers

```bash
# Test ESL reachability from within the enrs-backend container
docker compose exec enrs-backend sh -c \
  "nc -z host.docker.internal 8021 && echo OK || echo FAILED"
```

### Verify Lua integration variables

```bash
fs_cli -x "global_getvar FS_INTERNAL_KEY"
fs_cli -x "global_getvar ENRS_API_URL"
```

### IVR / Dialplan deployment

After publishing an IVR flow in the ENRS UI, the IVR builder writes Lua scripts and XML dialplan entries to the paths configured in `.env`. FreeSWITCH must reload to pick them up:

```bash
fs_cli -x "reloadxml"
fs_cli -x "reload mod_lua"
```

---

## Upgrades

### Pull new images

```bash
cd /opt/omni/deploy
docker compose pull
docker compose up -d
```

### Rebuild from source

```bash
cd /opt/omni/deploy
docker compose build --no-cache
docker compose up -d
```

### Rolling upgrade (minimize downtime)

```bash
# Backends first
docker compose up -d --no-deps cc-backend enrs-backend

# Wait for healthy
docker compose ps

# Then frontends
docker compose up -d --no-deps cc-frontend enrs-frontend agent-desktop

# Finally nginx
docker compose up -d --no-deps nginx
```

---

## Monitoring

### Resource usage

```bash
docker stats
docker stats --no-stream    # one-shot snapshot
```

### PostgreSQL query activity

```bash
docker compose exec postgres psql -U postgres -c \
  "SELECT pid, state, query_start, query FROM pg_stat_activity WHERE state='active';"
```

### Redis memory

```bash
docker compose exec redis redis-cli info memory | grep -E "used_memory_human|maxmemory"
```

### Disk usage

```bash
df -h
du -sh /opt/omni/deploy/logs/
du -sh /var/lib/freeswitch/recordings/  # or FS_RECORDING_DIR from .env
docker system df
```

### nginx access log

```bash
tail -f /opt/omni/deploy/logs/nginx/access.log
```

---

## User Management (ENRS)

ENRS users are managed through the ENRS admin panel at `https://<SERVER_NAME>/enrs/`.

The seed admin account is created on first startup using `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from `.env`. Change the password immediately after first login.

For database-level admin operations:

```bash
# List ENRS users
docker compose exec postgres psql -U postgres -d fs_enrs -c \
  "SELECT email, role, created_at FROM users WHERE deleted_at IS NULL ORDER BY created_at;"
```

---

## SSL Certificate Renewal

### Let's Encrypt (manual renewal)

```bash
docker compose stop nginx
certbot renew
cp /etc/letsencrypt/live/omni.company.com/*.pem /opt/omni/deploy/ssl/
docker compose start nginx
```

### Check certificate expiry

```bash
openssl x509 -enddate -noout -in /opt/omni/deploy/ssl/fullchain.pem
```

---

## Platform Health Endpoints

These endpoints are accessible from the host only (backends bind to `127.0.0.1`):

| Endpoint | Expected | Notes |
|----------|---------|-------|
| `http://127.0.0.1:4000/api/health` | `{"status":"ok"}` | CC backend |
| `http://127.0.0.1:4100/health/live` | `{"status":"ok"}` | ENRS process alive (no external deps) |
| `http://127.0.0.1:4100/health/ready` | `{"status":"ok"}` | ENRS DB + ESL connected (used by Docker HEALTHCHECK) |

Via nginx (requires TLS, self-signed):

| Endpoint | Expected |
|----------|---------|
| `https://SERVER_NAME/_health` | HTTP 200 |
| `https://SERVER_NAME/cc/` | HTTP 200 |
| `https://SERVER_NAME/enrs/` | HTTP 200 |
