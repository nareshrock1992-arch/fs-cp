# Installation Guide

## Prerequisites

| Requirement | Version |
|---|---|
| Docker Engine | 24+ |
| Docker Compose | v2+ (`docker compose`, not `docker-compose`) |
| FreeSWITCH | Running with `mod_callcenter` and ESL on port 8021 |

---

## Step 1 — Clone / copy the project

```bash
git clone <your-repo-url> fs-cc
cd fs-cc
```

---

## Step 2 — Configure

```bash
cp .env.example .env
nano .env
```

You **only need to edit four values**:

```env
SERVER_IP=192.168.1.x          # Your server's LAN IP
DB_PASSWORD=YourSecurePassword
FS_ESL_HOST=192.168.1.x        # IP of your FreeSWITCH server (often same as SERVER_IP)
JWT_SECRET=random-32-char-string
```

`CORS_ORIGIN` and `FS_ESL_HOST` automatically use `SERVER_IP` in the default template.

> **Tip**: Generate a JWT secret:  
> `openssl rand -hex 32`

---

## Step 3 — Start the stack

```bash
docker compose up -d
```

This starts:
- **db** — PostgreSQL 16 (port 5432, internal only)
- **backend** — Node.js API + FreeSWITCH ESL bridge (port 4000)
- **frontend** — Nginx serving React SPA (port 8000)

The database schema and all migrations run automatically on first start.

---

## Step 4 — Create the admin user

```bash
# Generate a bcrypt hash for your password
docker exec -it fs-cc-backend-1 node -e \
  "import('bcryptjs').then(b=>b.default.hash('YourPassword',10).then(console.log))"

# Insert the admin user
docker exec -it fs-cc-db-1 psql -U fs_cc -d fs_cc -c \
  "INSERT INTO users (username, password_hash, role)
   VALUES ('admin', '<HASH>', 'admin')
   ON CONFLICT (username) DO UPDATE SET password_hash = '<HASH>';"
```

---

## Step 5 — Open the UI

```
http://<SERVER_IP>:8000
```

---

## Verify everything is healthy

```bash
docker compose ps          # all services should show "healthy"
docker compose logs -f     # stream all logs
curl http://localhost:4000/api/health   # should return {"ok":true}
```

---

## FreeSWITCH on the same server

If FreeSWITCH runs on the **same Docker host**:

```env
FS_ESL_HOST=host.docker.internal   # Mac/Windows
FS_ESL_HOST=172.17.0.1             # Linux (docker0 bridge IP)
```

Or use the server's LAN IP — that always works.
