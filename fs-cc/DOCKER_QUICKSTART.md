# Docker Quick-Start

## Prerequisites
- Docker Desktop installed and running
- FreeSWITCH running on the host (or another server) with ESL on port 8021

## 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:
- `SERVER_IP` — LAN IP of your server (e.g. `192.168.1.x`)
- `FS_ESL_HOST` — IP of your FreeSWITCH server (often same as `SERVER_IP`)
- `DB_PASSWORD` — Change from default `changeme`
- `JWT_SECRET` — Random 32+ character string (`openssl rand -hex 32`)

## 2. Start everything

```bash
docker compose up -d
```

This starts:
- `db`             — PostgreSQL 14, auto-runs all migrations, persists in `db_data` volume
- `backend`        — Node.js API + FreeSWITCH ESL bridge (port 4000)
- `frontend`       — Admin UI — Nginx + React SPA (port 8000)
- `agent-desktop`  — Agent Desktop — Nginx + React SPA (port 8080)

## 3. Access the UIs

| UI | URL | Default credentials |
|---|---|---|
| Admin UI | `http://<SERVER_IP>:8000` | admin / admin123 |
| Agent Desktop | `http://<SERVER_IP>:8080` | (agent_id + PIN — set by admin) |

## 4. Set an agent PIN (required for Agent Desktop login)

Agents log into the Agent Desktop with their `agent_id` and a **PIN** set by an admin.

To set a PIN via the Admin API:
```bash
# Replace agent_1001 and 1234 with the actual agent ID and PIN
curl -s -X POST http://<SERVER_IP>:4000/api/agents/agent_1001/set-pin \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"pin": "1234"}'
```

To get an admin JWT (login first):
```bash
curl -s -X POST http://<SERVER_IP>:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token
```

## 5. Create the first admin user

If the `users` table is empty (fresh DB volume):

```bash
# 1. Generate bcrypt hash for "admin123"
docker exec -it fs-cc-backend-1 node -e \
  "const b=require('bcryptjs'); console.log(b.hashSync('admin123',10));"

# 2. Insert the user (replace <HASH> with output from step 1)
docker exec -it fs-cc-db-1 psql -U fs_cc -d fs_cc -c \
  "INSERT INTO users (username, password_hash, role)
   VALUES ('admin', '<HASH>', 'admin')
   ON CONFLICT (username) DO UPDATE SET password_hash = '<HASH>';"
```

## 6. Useful commands

```bash
# View logs
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f agent-desktop

# Restart backend only (after config change)
docker compose restart backend

# Apply DB migrations manually
docker compose exec backend node db/init.js

# Stop everything
docker compose down

# Stop and wipe the database (WARNING: destroys all data)
docker compose down -v
```

## 7. FreeSWITCH on the same host

If FreeSWITCH runs on the Docker host machine, use:
```env
FS_ESL_HOST=host.docker.internal   # Mac/Windows Docker Desktop
# OR
FS_ESL_HOST=172.17.0.1             # Linux (host bridge IP)
```

## 8. Generate FreeSWITCH callcenter XML config

To write `callcenter.conf.xml` from the current DB state (useful for FS restarts):

```bash
# Preview the XML without writing to disk
curl -s http://localhost:4000/api/queues/preview-xml \
  -H "Authorization: Bearer <ADMIN_JWT>"

# Write to disk and trigger reloadxml (requires FS_CONF_PATH in .env)
curl -s -X POST http://localhost:4000/api/queues/export-xml \
  -H "Authorization: Bearer <ADMIN_JWT>"
```

Set `FS_CONF_PATH=/etc/freeswitch` in your `.env` for the write to work.

## 9. Upgrade

```bash
git pull
docker compose build --no-cache
docker compose up -d
```
