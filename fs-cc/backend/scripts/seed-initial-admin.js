/**
 * Initial admin bootstrap script for fs-cc.
 *
 * Usage:
 *   node /app/scripts/seed-initial-admin.js
 *   npm run seed:admin
 *
 * fs-cc role architecture:
 *   - 'admin'      — full system access (highest privilege)
 *   - 'supervisor' — limited management access
 * There is no SUPER_ADMIN or multi-tenancy in fs-cc.
 * The 'admin' role is the equivalent first-boot privileged account.
 *
 * Behaviour:
 *   1. Connects using the existing db/pool.js configuration.
 *   2. Checks whether any active 'admin' user exists.
 *      - If one exists → logs and exits 0 (no changes).
 *   3. Validates CC_INITIAL_ADMIN_USERNAME and CC_INITIAL_ADMIN_PASSWORD.
 *      - If missing → exits 1 with a clear message.
 *   4. Validates username length and password policy.
 *   5. Hashes password with bcryptjs at 10 rounds (fs-cc standard).
 *   6. Inserts the admin user in a transaction.
 *      - If username already exists (non-admin) → exits 1 with clear message.
 *      - On success → logs username and ID, exits 0.
 *      - On failure → rolls back, exits 1.
 *
 * Idempotency:
 *   Safe to run on every container startup. If an admin already exists
 *   the script performs one SELECT and exits without writes.
 *
 * What is NEVER logged:
 *   - plaintext passwords
 *   - bcrypt hashes
 */

// Dotenv is loaded transitively: pool.js → config/index.js → dotenv/config
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';

const BCRYPT_ROUNDS = 10; // fs-cc standard — matches usersController.js

// fs-cc password policy: min 8 chars (enforced here; the UI enforces more)
const MIN_PASSWORD_LEN = 8;

function fail(msg) {
  console.error(`[seed-initial-admin:cc] ERROR: ${msg}`);
  process.exit(1);
}

async function run() {
  // ── 1. Check for existing admin user ──────────────────────────────────────
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    fail(`Cannot connect to database — check DB_* env vars. (${err.message})`);
  }

  try {
    const { rows: existing } = await client.query(
      `SELECT id, username FROM users WHERE role = 'admin' LIMIT 1`
    );

    if (existing.length > 0) {
      console.log(`[seed-initial-admin:cc] Admin already exists (id=${existing[0].id}, username=${existing[0].username}). No changes made.`);
      return;
    }

    console.log('[seed-initial-admin:cc] No admin user found. Checking bootstrap variables ...');

    // ── 2. Validate required env vars ────────────────────────────────────────
    const username = (process.env.CC_INITIAL_ADMIN_USERNAME || '').trim().toLowerCase();
    const password = (process.env.CC_INITIAL_ADMIN_PASSWORD || '').trim();

    if (!username) {
      fail(
        'CC_INITIAL_ADMIN_USERNAME is not set.\n' +
        '  Set it in .env or as an environment variable.\n' +
        '  Example: CC_INITIAL_ADMIN_USERNAME=admin'
      );
    }

    if (!password) {
      fail(
        'CC_INITIAL_ADMIN_PASSWORD is not set.\n' +
        '  Set it in .env or as an environment variable.\n' +
        '  Never commit the password to source control.'
      );
    }

    // ── 3. Validate username ──────────────────────────────────────────────────
    if (username.length < 3 || username.length > 64) {
      fail('CC_INITIAL_ADMIN_USERNAME must be between 3 and 64 characters.');
    }
    if (!/^[a-z0-9._-]+$/.test(username)) {
      fail('CC_INITIAL_ADMIN_USERNAME may only contain lowercase letters, digits, dots, underscores, and hyphens.');
    }

    // ── 4. Validate password ──────────────────────────────────────────────────
    if (password.length < MIN_PASSWORD_LEN) {
      fail(`CC_INITIAL_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LEN} characters.`);
    }

    // ── 5. Check for conflicting non-admin username ───────────────────────────
    const { rows: existing2 } = await client.query(
      `SELECT id, role FROM users WHERE username = $1 LIMIT 1`,
      [username]
    );
    if (existing2.length > 0) {
      fail(
        `A user with username "${username}" already exists (id=${existing2[0].id}, role=${existing2[0].role}).\n` +
        '  Choose a different CC_INITIAL_ADMIN_USERNAME or delete the existing user first.'
      );
    }

    // ── 6. Hash password ──────────────────────────────────────────────────────
    console.log('[seed-initial-admin:cc] Hashing password ...');
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    // Never log the hash or plaintext.

    // ── 7. Insert in a transaction ────────────────────────────────────────────
    await client.query('BEGIN');
    let created;
    try {
      const { rows: [user] } = await client.query(
        `INSERT INTO users (username, password_hash, role)
         VALUES ($1, $2, 'admin')
         RETURNING id, username, role`,
        [username, passwordHash]
      );
      await client.query('COMMIT');
      created = user;
    } catch (err) {
      await client.query('ROLLBACK');
      fail(`Database insert failed: ${err.message}`);
    }

    console.log('[seed-initial-admin:cc] Admin user created successfully.');
    console.log(`[seed-initial-admin:cc]   id      : ${created.id}`);
    console.log(`[seed-initial-admin:cc]   username: ${created.username}`);
    console.log(`[seed-initial-admin:cc]   role    : ${created.role}`);

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(`[seed-initial-admin:cc] Unexpected error: ${err.message}`);
  process.exit(1);
});
