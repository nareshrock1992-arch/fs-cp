#!/bin/sh
# Docker entrypoint for the fs-cc backend container.
#
# Sequence on every startup:
#   1. Run database migrations (idempotent — safe to run on every boot).
#   2. Run initial admin bootstrap (exits immediately if any admin already exists).
#   3. Hand off to CMD (node server.js) which also calls runMigrations() on
#      startup — that second call is a no-op and harmless.
#
# If any step exits non-zero this script also exits non-zero and the container
# does NOT start. Docker's restart policy will retry — correct behaviour for
# a transient DB connection failure at startup.
set -e

echo "[entrypoint] Running database migrations ..."
node scripts/migrate.js

echo "[entrypoint] Running initial admin bootstrap ..."
node scripts/seed-initial-admin.js

echo "[entrypoint] Bootstrap complete. Starting server ..."
exec "$@"
