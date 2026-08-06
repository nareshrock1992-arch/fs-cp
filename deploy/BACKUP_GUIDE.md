# Omni Platform — Backup and Restore Guide

**Target OS:** Debian Bookworm (12)

---

## What to Back Up

| Data | Location | Priority |
|------|----------|----------|
| `.env` | `deploy/.env` | **Critical** |
| PostgreSQL databases | Docker volume | **Critical** |
| Recordings | `FS_RECORDING_DIR` from `.env` | High |
| Uploaded files | `deploy/uploads/` | High |
| FreeSWITCH config | `FS_CONF_DIR` from `.env` | High |
| SSL certificates | `deploy/ssl/` | Medium |
| Deployment scripts | `deploy/` (git-tracked) | Medium — use git |

---

## PostgreSQL Backup

### Dump both databases

```bash
cd /opt/omni/deploy

# CC database
docker compose exec -T postgres \
  pg_dump -U postgres fs_cc \
  | gzip > backups/postgres/fs_cc_$(date +%Y%m%d_%H%M%S).sql.gz

# ENRS database
docker compose exec -T postgres \
  pg_dump -U postgres fs_enrs \
  | gzip > backups/postgres/fs_enrs_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Dump all databases at once

```bash
docker compose exec -T postgres \
  pg_dumpall -U postgres \
  | gzip > backups/postgres/all_databases_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Automated daily backup (cron)

Create `/etc/cron.d/omni-backup`:

```
# Daily database backup at 02:00
0 2 * * * root \
  cd /opt/omni/deploy && \
  docker compose exec -T postgres pg_dump -U postgres fs_cc | gzip > backups/postgres/fs_cc_$(date +\%Y\%m\%d).sql.gz && \
  docker compose exec -T postgres pg_dump -U postgres fs_enrs | gzip > backups/postgres/fs_enrs_$(date +\%Y\%m\%d).sql.gz

# Keep 30 days of backups
30 2 * * * root find /opt/omni/deploy/backups/postgres -name "*.sql.gz" -mtime +30 -delete
```

---

## PostgreSQL Restore

### Restore a single database

```bash
# Restore CC database
gunzip -c backups/postgres/fs_cc_20260801_020000.sql.gz \
  | docker compose exec -T postgres psql -U postgres -d fs_cc

# Restore ENRS database
gunzip -c backups/postgres/fs_enrs_20260801_020000.sql.gz \
  | docker compose exec -T postgres psql -U postgres -d fs_enrs
```

### Full restore from scratch

```bash
# 1. Stop applications (leave postgres running)
docker compose stop cc-backend enrs-backend cc-frontend enrs-frontend agent-desktop nginx

# 2. Drop and recreate databases
docker compose exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS fs_cc;"
docker compose exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS fs_enrs;"
docker compose exec postgres psql -U postgres -c "CREATE DATABASE fs_cc OWNER fs_cc_user;"
docker compose exec postgres psql -U postgres -c "CREATE DATABASE fs_enrs OWNER fs_enrs_user;"

# 3. Restore
gunzip -c backups/postgres/fs_cc_TIMESTAMP.sql.gz \
  | docker compose exec -T postgres psql -U postgres -d fs_cc
gunzip -c backups/postgres/fs_enrs_TIMESTAMP.sql.gz \
  | docker compose exec -T postgres psql -U postgres -d fs_enrs

# 4. Restart everything
docker compose up -d
```

---

## .env Backup

```bash
# Backup
cp deploy/.env backups/configs/env_$(date +%Y%m%d).bak

# The .env file is excluded from git (.gitignore) — back it up separately
# Store it encrypted or in a secrets manager — it contains all credentials
```

---

## Recordings Backup

Recordings are written by FreeSWITCH to the host path in `FS_RECORDING_DIR`.

```bash
# Read the path from .env
FS_RECORDING_DIR=$(grep '^FS_RECORDING_DIR=' /opt/omni/deploy/.env | cut -d= -f2)

# Rsync to remote (example)
rsync -avz --progress \
  "${FS_RECORDING_DIR}/" \
  backup-server:/backups/omni/recordings/

# Tar archive
tar -czf backups/recordings_$(date +%Y%m%d).tar.gz "${FS_RECORDING_DIR}"
```

---

## FreeSWITCH Configuration Backup

```bash
FS_CONF_DIR=$(grep '^FS_CONF_DIR=' /opt/omni/deploy/.env | cut -d= -f2)

tar -czf backups/configs/freeswitch_$(date +%Y%m%d).tar.gz "${FS_CONF_DIR}"
```

---

## Uploads Backup

```bash
tar -czf backups/uploads_$(date +%Y%m%d).tar.gz deploy/uploads/
```

---

## Full Platform Backup (all at once)

```bash
#!/usr/bin/env bash
# Run as: sudo bash deploy/scripts/backup.sh (if you create this script)

set -euo pipefail
DEPLOY=/opt/omni/deploy
BACKUP_DIR="${DEPLOY}/backups"
TS=$(date +%Y%m%d_%H%M%S)

mkdir -p "${BACKUP_DIR}/postgres" "${BACKUP_DIR}/configs"

source <(grep -E '^(FS_CONF_DIR|FS_RECORDING_DIR)=' "${DEPLOY}/.env")

# Databases
cd "${DEPLOY}"
docker compose exec -T postgres pg_dump -U postgres fs_cc   | gzip > "${BACKUP_DIR}/postgres/fs_cc_${TS}.sql.gz"
docker compose exec -T postgres pg_dump -U postgres fs_enrs | gzip > "${BACKUP_DIR}/postgres/fs_enrs_${TS}.sql.gz"

# Configs
cp "${DEPLOY}/.env" "${BACKUP_DIR}/configs/env_${TS}.bak"
tar -czf "${BACKUP_DIR}/configs/freeswitch_${TS}.tar.gz" "${FS_CONF_DIR}" 2>/dev/null || true

echo "Backup complete: ${BACKUP_DIR}"
```

---

## Disaster Recovery

### Complete platform rebuild

1. **Provision a new server** with the same OS.

2. **Restore `.env`:**
   ```bash
   cp /path/to/backup/env_TIMESTAMP.bak /opt/omni/deploy/.env
   ```

3. **Restore FreeSWITCH config:**
   ```bash
   tar -xzf backups/configs/freeswitch_TIMESTAMP.tar.gz -C /
   ```

4. **Run prepare scripts:**
   ```bash
   sudo bash deploy/scripts/prepare-directories.sh
   sudo bash deploy/scripts/prepare-freeswitch.sh
   bash deploy/scripts/generate-self-signed.sh
   ```

5. **Start the stack:**
   ```bash
   docker compose up -d
   ```

6. **Restore databases:**
   ```bash
   docker compose stop cc-backend enrs-backend cc-frontend enrs-frontend agent-desktop nginx

   docker compose exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS fs_cc; CREATE DATABASE fs_cc OWNER fs_cc_user;"
   docker compose exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS fs_enrs; CREATE DATABASE fs_enrs OWNER fs_enrs_user;"

   gunzip -c backups/postgres/fs_cc_TIMESTAMP.sql.gz   | docker compose exec -T postgres psql -U postgres -d fs_cc
   gunzip -c backups/postgres/fs_enrs_TIMESTAMP.sql.gz | docker compose exec -T postgres psql -U postgres -d fs_enrs

   docker compose up -d
   ```

7. **Restore recordings:**
   ```bash
   FS_RECORDING_DIR=$(grep '^FS_RECORDING_DIR=' deploy/.env | cut -d= -f2)
   rsync -avz backup-server:/backups/omni/recordings/ "${FS_RECORDING_DIR}/"
   ```

8. **Verify:**
   ```bash
   bash deploy/scripts/verify-install.sh
   ```

---

## Recovery Point Objectives

| Component | Recommended Backup Frequency |
|-----------|------------------------------|
| PostgreSQL | Daily minimum; hourly for active production |
| `.env` | After every change |
| Recordings | Daily rsync |
| FS config | After every change |

---

## Backup Storage

- Store backups **off the deployment server** (remote host, S3, NAS)
- `.env` contains all platform secrets — encrypt it before off-site storage: `gpg --symmetric backups/configs/env_TIMESTAMP.bak`
- Test restores regularly — a backup never tested is not a backup
