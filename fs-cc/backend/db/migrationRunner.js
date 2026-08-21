import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Arbitrary stable integer used as the PostgreSQL session-level advisory lock key.
// Prevents two containers or processes from running migrations simultaneously.
// Released automatically when the pool client is returned in the finally block.
const MIGRATION_LOCK_ID = 7842910;

// The 7 files that init.js / docker-entrypoint-initdb.d applied on every
// pre-Phase-1 deployment. We register them as already applied so the runner
// never re-runs them on existing databases.
const BASELINE_VERSIONS = [
  'schema.sql',
  'migrate_auth.sql',
  'migrate_ivr.sql',
  'migrate_reporting.sql',
  'migrate_cdr_views.sql',
  'migrate_indexes.sql',
  'migrate_agent_auth.sql',
];

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

// ── Detect fresh vs existing DB ──────────────────────────────────────────────

async function isFreshDatabase(client) {
  const { rows } = await client.query(
    `SELECT to_regclass('public.agents') AS tbl`
  );
  return rows[0].tbl === null;
}

// ── Baseline registration (existing deployments) ─────────────────────────────

async function registerBaseline(client) {
  for (const version of BASELINE_VERSIONS) {
    await client.query(
      `INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`,
      [version]
    );
  }
}

// ── Apply baseline files (fresh DB without Docker initdb) ────────────────────

async function applyBaselineFiles(client) {
  for (const version of BASELINE_VERSIONS) {
    const filePath = path.join(__dirname, version);
    if (!fs.existsSync(filePath)) {
      console.warn(`[migrations] baseline file not found, skipping: ${version}`);
      continue;
    }
    console.log(`[migrations] applying baseline: ${version}`);
    const sql = fs.readFileSync(filePath, 'utf8');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`,
      [version]
    );
  }
}

// ── Apply numbered migrations ────────────────────────────────────────────────
//
// CONTRACT for migration files in db/migrations/:
//   • Files MUST NOT contain their own BEGIN or COMMIT statements.
//   • The runner wraps every migration in a single transaction that also
//     records the migration in schema_migrations on success.
//   • Idempotent DDL (IF NOT EXISTS, DO $$ blocks) must be used for any
//     operations that cannot be rolled back (e.g. CREATE INDEX CONCURRENTLY),
//     but those are rare — ordinary DDL in PostgreSQL is fully transactional.
//   • If a migration fails, the transaction is rolled back, the file stays
//     absent from schema_migrations, and the runner re-throws so the server
//     exits rather than starting against a partially migrated schema.

async function applyNumberedMigrations(client) {
  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await client.query(
      `SELECT 1 FROM schema_migrations WHERE version = $1`,
      [file]
    );
    if (rows.length > 0) {
      console.log(`[migrations] already applied: ${file}`);
      continue;
    }

    console.log(`[migrations] applying: ${file}`);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (version) VALUES ($1)`,
        [file]
      );
      await client.query('COMMIT');
      console.log(`[migrations] ✓ applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      // Re-throw so server startup fails rather than running against a
      // partially migrated schema.
      throw new Error(`[migrations] FAILED: ${file} — ${err.message}`);
    }
  }
}

// ── Public entry point ───────────────────────────────────────────────────────

export async function runMigrations() {
  const client = await pool.connect();
  try {
    // Acquire an exclusive session-level advisory lock before inspecting or
    // modifying migration state. pg_advisory_lock blocks until the lock is
    // available, so a second container/process will wait here rather than
    // running concurrently. The lock is released automatically when the client
    // is returned to the pool in the finally block below.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    console.log('[migrations] advisory lock acquired');

    await bootstrap(client);

    const fresh = await isFreshDatabase(client);

    if (fresh) {
      console.log('[migrations] fresh database detected — applying all baseline files');
      await applyBaselineFiles(client);
    } else {
      console.log('[migrations] existing database detected — registering baseline');
      await registerBaseline(client);
    }

    await applyNumberedMigrations(client);
    console.log('[migrations] ✓ all migrations complete');
  } finally {
    // pg_advisory_lock is session-level: released when the connection is
    // returned to the pool. No explicit unlock needed, but we log it for clarity.
    console.log('[migrations] advisory lock released');
    client.release();
  }
}
