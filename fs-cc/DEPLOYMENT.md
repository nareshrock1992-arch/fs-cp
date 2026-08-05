# Docker Build & Deployment Guide

This guide covers building Docker images on your development machine, exporting them to a tarball, transferring to a customer server, and running the full stack in production.

---

## Table of Contents

1. [One-page Summary](#one-page-summary)
2. [Part 1 — Build Images on Dev Machine](#part-1--build-images-on-dev-machine)
3. [Part 2 — Export Images to Tarball](#part-2--export-images-to-tarball)
4. [Part 3 — Transfer to Customer Server](#part-3--transfer-to-customer-server)
5. [Part 4 — Customer Deployment](#part-4--customer-deployment)
6. [Part 5 — Post-Deployment Verification](#part-5--post-deployment-verification)
7. [Part 6 — Updates & Maintenance](#part-6--updates--maintenance)
8. [Production Checklist](#production-checklist)
9. [Health Checks Reference](#health-checks-reference)
10. [Ports Quick Reference](#ports-quick-reference)

---

## One-page Summary

```
Dev machine                      Customer server
───────────────────              ───────────────
docker compose build             docker load < fscc-images.tar.gz
docker save ... | gzip  ──────►  cp docker-compose.yml + .env
                      scp/USB    docker compose up -d
                                 (set PIN via Admin UI or curl)
                                 Browser → http://SERVER_IP:8000
                                           http://SERVER_IP:8080
```

---

## Part 1 — Build Images on Dev Machine

### 1.1 — Ensure the repo is clean

```bash
cd /path/to/fs-cc
git status          # confirm no untracked secrets in .env or node_modules
```

### 1.2 — Build all images

```bash
docker compose build --no-cache
```

This builds three images:
- `fs-cc-backend` — Node 20 + Express API
- `fs-cc-frontend` — Nginx + React Admin UI (static)
- `fs-cc-agent-desktop` — Nginx + React Agent Desktop (static)

> The frontend and agent-desktop images bake in `VITE_API_URL=/api` (relative path).  
> Nginx proxies `/api` and `/socket.io` to the backend container at runtime.  
> **No IP addresses are embedded in the builds.**

### 1.3 — Verify images

```bash
docker images | grep fs-cc
# Expected:
# fs-cc-backend         latest   ...
# fs-cc-frontend        latest   ...
# fs-cc-agent-desktop   latest   ...
```

### 1.4 — Optional smoke test (on dev machine)

```bash
# Start full stack
cp .env.example .env
# Edit .env: set SERVER_IP=localhost, DB_PASSWORD, JWT_SECRET
docker compose up -d

# Wait for healthy status (~30s)
docker compose ps

# Test backend health
curl http://localhost:4000/api/health
# → {"status":"ok","time":"..."}

# Tear down after test
docker compose down
```

---

## Part 2 — Export Images to Tarball

### 2.1 — Get the exact image names/tags

```bash
docker compose config --images
# or
docker images | grep fs-cc
```

### 2.2 — Save to compressed tarball

```bash
docker save \
  fs-cc-backend:latest \
  fs-cc-frontend:latest \
  fs-cc-agent-desktop:latest \
  postgres:14-alpine \
  | gzip > fscc-images.tar.gz

echo "Archive size: $(du -sh fscc-images.tar.gz | cut -f1)"
```

> Including `postgres:14-alpine` in the archive means the customer server needs no internet access for the DB image.

### 2.3 — Prepare the deployment bundle

```bash
mkdir fscc-deploy

# Images
cp fscc-images.tar.gz fscc-deploy/

# Compose file + env template
cp docker-compose.yml fscc-deploy/
cp .env.example       fscc-deploy/.env.example

# Optional: dialplan snippets
cp -r dialplan        fscc-deploy/

# Zip it up for transfer
zip -r fscc-deploy.zip fscc-deploy/
```

---

## Part 3 — Transfer to Customer Server

### Option A — SCP (network)

```bash
scp fscc-deploy.zip user@CUSTOMER_SERVER:/home/user/
```

### Option B — USB / physical media

Copy `fscc-deploy.zip` to a USB drive. On the customer server:

```bash
cp /media/usb/fscc-deploy.zip /home/user/
```

### Option C — Rsync (resumable)

```bash
rsync -avz --progress fscc-deploy.zip user@CUSTOMER_SERVER:/home/user/
```

---

## Part 4 — Customer Deployment

### 4.1 — Prerequisites on the customer server

```bash
# Docker Engine
docker --version    # 24+ recommended
docker compose version   # v2 plugin (not standalone docker-compose)

# If not installed (Ubuntu/Debian):
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out + back in
```

### 4.2 — Unpack the bundle

```bash
cd /home/user
unzip fscc-deploy.zip
cd fscc-deploy
```

### 4.3 — Load Docker images

```bash
docker load < fscc-images.tar.gz
# Loads: backend, frontend, agent-desktop, postgres:14-alpine

docker images   # verify all four images are present
```

### 4.4 — Configure environment

```bash
cp .env.example .env
nano .env   # or vi .env
```

Set these four values (everything else can stay at defaults):

```env
# ★ 1 — Your server's LAN IP (what browsers use to reach this machine)
SERVER_IP=192.168.1.100

# ★ 2 — Database password
DB_PASSWORD=choose_a_strong_password

# ★ 3 — FreeSWITCH host (usually same as SERVER_IP unless FS is on another box)
FS_ESL_HOST=192.168.1.100

# ★ 4 — JWT secret (32+ random chars)
JWT_SECRET=xK9mP2qR7vL4nT8wY1aB5cD3eF6hJ0iZ
```

Also update `CORS_ORIGIN` to match both UI ports:

```env
CORS_ORIGIN=http://192.168.1.100:8000,http://192.168.1.100:8080
```

### 4.5 — Start the stack

```bash
docker compose up -d

# Watch startup logs
docker compose logs -f --tail=50
```

Wait ~30 seconds for:
1. PostgreSQL to initialise (runs all 7 SQL migrations automatically)
2. Backend to pass its health check
3. Frontend and Agent Desktop containers to start

```bash
docker compose ps
# All services should show "healthy" or "Up"
```

### 4.6 — Create first admin user

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your_secure_password"}'
# → {"id":1,"username":"admin","role":"admin"}
```

> After the first user is created, `/api/auth/register` can be restricted or the route disabled for security.

### 4.7 — Verify admin login

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your_secure_password"}' \
  | jq -r .token)

echo $TOKEN   # should be a JWT string
```

### 4.8 — Set agent PINs

**Option A — Admin UI (recommended):**

1. Open `http://SERVER_IP:8000` in a browser
2. Navigate to **Agents**
3. For each agent, click the 🔑 key icon and set a PIN (4+ digits)

**Option B — curl:**

```bash
# List agents to get their agent_id values
curl http://localhost:4000/api/agents \
  -H "Authorization: Bearer $TOKEN" | jq '.[].agent_id'

# Set PIN for a specific agent
curl -X POST http://localhost:4000/api/agents/Agent_1001@default/set-pin \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"pin":"1234"}'
# → {"ok":true,"message":"PIN updated for Agent_1001@default"}
```

### 4.9 — Test Agent Desktop login

```bash
curl -X POST http://localhost:8080/api/agent-desk/login \
  -H 'Content-Type: application/json' \
  -d '{"agent_id":"Agent_1001@default","pin":"1234"}'
# → {"token":"eyJ...","agent":{"agent_id":"Agent_1001@default",...}}
```

---

## Part 5 — Post-Deployment Verification

### Browser test matrix

| URL | Expected |
|---|---|
| `http://SERVER_IP:8000` | Admin UI login page loads |
| `http://SERVER_IP:8000/api/health` | `{"status":"ok"}` |
| `http://SERVER_IP:8080` | Agent Desktop login page loads |
| `http://SERVER_IP:8080/api/agent-desk/login` | 400 (missing body — good, endpoint is reachable) |

### Container health check

```bash
docker compose ps
# NAME                    STATUS              PORTS
# fscc-db-1               Up (healthy)        5432/tcp
# fscc-backend-1          Up (healthy)        0.0.0.0:4000->4000/tcp
# fscc-frontend-1         Up (healthy)        0.0.0.0:8000->80/tcp
# fscc-agent-desktop-1    Up (healthy)        0.0.0.0:8080->80/tcp
```

### ESL connection check

```bash
curl http://localhost:4000/api/health -s | jq .
# Look for eslConnected: true (field may vary by implementation)

# Or watch backend logs for:
docker compose logs backend | grep -i esl
# [esl] Connected to FreeSWITCH at 192.168.1.100:8021
```

### Database check

```bash
docker compose exec db psql -U fs_cc -d fs_cc -c "\dt"
# Should list: agents, queues, agent_tiers, calls, agent_history, agent_state_log, users, ...

docker compose exec db psql -U fs_cc -d fs_cc \
  -c "SELECT agent_id, (pin_hash IS NOT NULL) AS has_pin FROM agents LIMIT 10;"
```

---

## Part 6 — Updates & Maintenance

### Rebuild and update a single service

```bash
# On dev machine
docker compose build backend
docker save fs-cc-backend:latest | gzip > backend-update.tar.gz
# Transfer to server, then:
docker load < backend-update.tar.gz
docker compose up -d --no-deps backend
```

### View live logs

```bash
docker compose logs -f backend           # Backend only
docker compose logs -f frontend          # Nginx access log
docker compose logs -f agent-desktop     # Nginx access log
```

### Restart a service

```bash
docker compose restart backend
```

### Backup the database

```bash
docker compose exec db pg_dump -U fs_cc fs_cc > backup_$(date +%Y%m%d).sql
```

### Restore the database

```bash
cat backup_20260101.sql | docker compose exec -T db psql -U fs_cc -d fs_cc
```

### Full stop / teardown

```bash
docker compose down           # Stops containers, keeps volumes (data preserved)
docker compose down -v        # Stops containers AND deletes volumes (wipes DB!)
```

---

## Production Checklist

### Before go-live

- [ ] `SERVER_IP` set to the correct LAN IP in `.env`
- [ ] `DB_PASSWORD` changed from default `changeme`
- [ ] `JWT_SECRET` is 32+ random characters (never the default)
- [ ] `FS_ESL_HOST` points to the FreeSWITCH server
- [ ] `FS_ESL_PASSWORD` matches `/etc/freeswitch/autoload_configs/event_socket.conf.xml`
- [ ] `CORS_ORIGIN` includes both `http://SERVER_IP:8000` and `http://SERVER_IP:8080`
- [ ] All four Docker images loaded successfully (`docker images`)
- [ ] All four containers are `healthy` (`docker compose ps`)
- [ ] Admin UI accessible at `:8000`
- [ ] Agent Desktop accessible at `:8080`
- [ ] First admin user created
- [ ] At least one agent exists in the system
- [ ] At least one agent has a PIN set
- [ ] Agent can log into the Agent Desktop and see their queue
- [ ] FreeSWITCH ESL badge shows "FS Connected" in Agent Desktop header
- [ ] A test call routes correctly through a queue

### Security hardening (optional but recommended)

- [ ] Place Nginx reverse proxy in front; add TLS/HTTPS certificates (Let's Encrypt)
- [ ] Restrict port 4000 to internal network only (frontend/agent-desktop proxy via Nginx)
- [ ] Restrict port 5432 to container network only (already the case with compose)
- [ ] Restrict port 8021 (ESL) on FreeSWITCH to the backend container's IP
- [ ] Change FreeSWITCH ESL password from default `ClueCon`
- [ ] Set up database backups (cron + pg_dump)
- [ ] Configure log rotation for Docker container logs

### Firewall (UFW example)

```bash
ufw allow 8000/tcp     # Admin UI
ufw allow 8080/tcp     # Agent Desktop
ufw deny  4000/tcp     # Backend — internal only; remove if direct API access needed
ufw deny  5432/tcp     # DB — internal only
```

---

## Health Checks Reference

| Service | Check command | Success indicator |
|---|---|---|
| Backend | `wget -qO- http://localhost:4000/api/health` | `{"status":"ok"}` |
| Frontend | `wget -qO- http://localhost/` | HTML returned |
| Agent Desktop | `wget -qO- http://localhost/` | HTML returned |
| PostgreSQL | `pg_isready -U fs_cc -d fs_cc` | `accepting connections` |

Compose health check intervals:
- DB: every 10 s, 5 retries
- Backend: every 15 s, start period 30 s, 3 retries
- Frontend / Agent Desktop: every 15 s, 3 retries

---

## Ports Quick Reference

| Port | Service | Accessible from |
|---|---|---|
| 8000 | Admin UI (Nginx) | Browser |
| 8080 | Agent Desktop (Nginx) | Browser |
| 4000 | Backend API | Internal (proxied by Nginx) |
| 5432 | PostgreSQL | Internal (Docker network only) |
| 8021 | FreeSWITCH ESL | Backend container → FS host |
