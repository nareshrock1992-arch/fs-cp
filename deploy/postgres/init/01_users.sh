#!/usr/bin/env bash
# 01_init.sh — Omni Platform PostgreSQL initialization
#
# Runs ONCE via docker-entrypoint-initdb.d on a fresh volume.
# The postgres container entrypoint sources .sh files as bash, giving access
# to all environment variables defined in the postgres service's environment block.
#
# Variables consumed (all provided by docker-compose.yml postgres environment):
#   POSTGRES_USER        — superuser name (e.g. postgres)
#   CC_DB_NAME           — fs_cc
#   CC_DB_USER           — fs_cc_user
#   CC_DB_PASSWORD       — application DB password
#   ENRS_DB_NAME         — fs_enrs
#   ENRS_DB_USER         — fs_enrs_user
#   ENRS_DB_PASSWORD     — application DB password
set -euo pipefail

echo "[init] Creating application users and databases..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL

  -- ── Create application users ──────────────────────────────────────────────
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${CC_DB_USER}') THEN
      CREATE USER ${CC_DB_USER} WITH PASSWORD '${CC_DB_PASSWORD}';
      RAISE NOTICE 'Created user: ${CC_DB_USER}';
    ELSE
      -- Update password in case it changed between deploys
      ALTER USER ${CC_DB_USER} WITH PASSWORD '${CC_DB_PASSWORD}';
      RAISE NOTICE 'User ${CC_DB_USER} already exists — password updated';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${ENRS_DB_USER}') THEN
      CREATE USER ${ENRS_DB_USER} WITH PASSWORD '${ENRS_DB_PASSWORD}';
      RAISE NOTICE 'Created user: ${ENRS_DB_USER}';
    ELSE
      ALTER USER ${ENRS_DB_USER} WITH PASSWORD '${ENRS_DB_PASSWORD}';
      RAISE NOTICE 'User ${ENRS_DB_USER} already exists — password updated';
    END IF;
  END
  \$\$;

  -- ── Create databases ──────────────────────────────────────────────────────
  SELECT 'CREATE DATABASE ${CC_DB_NAME} OWNER ${CC_DB_USER} ENCODING ''UTF8'''
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${CC_DB_NAME}')
  \gexec

  SELECT 'CREATE DATABASE ${ENRS_DB_NAME} OWNER ${ENRS_DB_USER} ENCODING ''UTF8'''
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${ENRS_DB_NAME}')
  \gexec

EOSQL

echo "[init] Setting permissions on ${CC_DB_NAME}..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${CC_DB_NAME}" <<-EOSQL

  -- Revoke defaults from public so only the app user can create objects
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  REVOKE ALL ON DATABASE ${CC_DB_NAME} FROM PUBLIC;

  -- Grant full access to the CC app user
  GRANT ALL PRIVILEGES ON DATABASE ${CC_DB_NAME} TO ${CC_DB_USER};
  GRANT ALL ON SCHEMA public TO ${CC_DB_USER};
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO ${CC_DB_USER};
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${CC_DB_USER};

  -- Explicitly deny ENRS user access to the CC database
  REVOKE ALL ON DATABASE ${CC_DB_NAME} FROM ${ENRS_DB_USER};

EOSQL

echo "[init] Setting permissions on ${ENRS_DB_NAME}..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${ENRS_DB_NAME}" <<-EOSQL

  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  REVOKE ALL ON DATABASE ${ENRS_DB_NAME} FROM PUBLIC;

  GRANT ALL PRIVILEGES ON DATABASE ${ENRS_DB_NAME} TO ${ENRS_DB_USER};
  GRANT ALL ON SCHEMA public TO ${ENRS_DB_USER};
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO ${ENRS_DB_USER};
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${ENRS_DB_USER};

  -- Explicitly deny CC user access to the ENRS database
  REVOKE ALL ON DATABASE ${ENRS_DB_NAME} FROM ${CC_DB_USER};

EOSQL

echo "[init] Database initialization complete."
echo "[init]   ${CC_DB_NAME}   → owner: ${CC_DB_USER}"
echo "[init]   ${ENRS_DB_NAME} → owner: ${ENRS_DB_USER}"
