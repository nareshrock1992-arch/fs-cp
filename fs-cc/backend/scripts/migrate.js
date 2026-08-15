/**
 * Standalone migration runner for use from docker-entrypoint.sh.
 *
 * fs-cc normally runs migrations inside server.js after listen(). This script
 * lets the Docker entrypoint run migrations before starting the server so that
 * seed-initial-admin.js can safely assume the schema exists.
 *
 * The migration function is idempotent — running it twice (here and again in
 * server.js) is safe.
 */

import { runMigrations } from '../db/migrationRunner.js';

try {
  await runMigrations();
  console.log('[migrate] All migrations complete.');
  process.exit(0);
} catch (err) {
  console.error('[migrate] Migration failed:', err.message);
  process.exit(1);
}
