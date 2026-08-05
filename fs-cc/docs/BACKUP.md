# Backup & Restore Guide

## What needs to be backed up

| Item | Location | Method |
|---|---|---|
| Database | Docker volume `fscc_db_data` | `pg_dump` |
| Configuration | Root `.env` file | Copy the file |
| Call recordings (if any) | Host filesystem | `rsync` / `cp` |

---

## Database backup

```bash
# Dump the full database to a SQL file
docker exec fs-cc-db-1 pg_dump -U fs_cc -d fs_cc > backup_$(date +%Y%m%d_%H%M%S).sql
```

Schedule daily backups with cron:

```cron
0 2 * * * docker exec fs-cc-db-1 pg_dump -U fs_cc -d fs_cc > /opt/backups/fscc_$(date +\%Y\%m\%d).sql
```

---

## Database restore

```bash
# Stop the stack (optional but safer)
docker compose stop backend frontend

# Restore from dump
docker exec -i fs-cc-db-1 psql -U fs_cc -d fs_cc < backup_20250101_020000.sql

# Restart
docker compose start backend frontend
```

---

## Configuration backup

```bash
cp .env .env.bak.$(date +%Y%m%d)
```

Store `.env` securely — it contains DB passwords and JWT secret.

---

## Full server migration

```bash
# On old server
docker exec fs-cc-db-1 pg_dump -U fs_cc -d fs_cc > fscc_db.sql
cp .env .env.bak

# Transfer
scp fscc_db.sql .env user@new-server:/opt/fs-cc/

# On new server
cd /opt/fs-cc
docker compose up -d db   # start DB only
sleep 10
docker exec -i fs-cc-db-1 psql -U fs_cc -d fs_cc < fscc_db.sql
docker compose up -d       # start remaining services
```
