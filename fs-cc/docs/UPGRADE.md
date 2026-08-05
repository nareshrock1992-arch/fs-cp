# Upgrade Guide

## Standard upgrade (no schema changes)

```bash
# 1. Pull latest code
git pull

# 2. Rebuild images (no-cache ensures latest code is included)
docker compose build --no-cache

# 3. Replace running containers with new images (zero-downtime restart)
docker compose up -d
```

The database volume (`fscc_db_data`) is preserved across upgrades.

---

## Upgrade with database migrations

If the new version includes new `.sql` migration files:

```bash
git pull
docker compose build --no-cache
docker compose up -d

# Run migrations against the live DB
docker compose exec backend node db/init.js
```

`db/init.js` uses `IF NOT EXISTS` throughout — it is safe to run multiple times.

---

## Offline / air-gapped upgrade

```bash
# On dev server — build and save images
docker compose build --no-cache
docker save -o fscc_backend.tar fs-cc-backend:latest
docker save -o fscc_frontend.tar fs-cc-frontend:latest

# Transfer to target server
scp fscc_backend.tar fscc_frontend.tar user@server:/opt/fs-cc/

# On target server — load and restart
cd /opt/fs-cc
docker load -i fscc_backend.tar
docker load -i fscc_frontend.tar
docker compose up -d
```

---

## Rollback

Each `docker compose build` tags images as `latest`. To rollback:

```bash
# Tag the previous image before upgrading
docker tag fs-cc-backend:latest fs-cc-backend:backup
docker tag fs-cc-frontend:latest fs-cc-frontend:backup

# If rollback needed:
docker tag fs-cc-backend:backup fs-cc-backend:latest
docker tag fs-cc-frontend:backup fs-cc-frontend:latest
docker compose up -d
```
