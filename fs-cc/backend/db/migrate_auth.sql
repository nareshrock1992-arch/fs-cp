-- ============================================================
-- Auth + agent_history migration
-- Run once:  psql -U your_user -d your_db -f migrate_auth.sql
-- ============================================================

-- 1. Users table for JWT login
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'supervisor'
                  CHECK (role IN ('admin', 'supervisor')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. agent_history: one row per agent-per-call (multiple rows per call for no-answer scenarios)
CREATE TABLE IF NOT EXISTS agent_history (
  id            BIGSERIAL PRIMARY KEY,
  call_uuid     VARCHAR(64) NOT NULL,
  agent_id      VARCHAR(64) NOT NULL,
  queue_name    VARCHAR(64),
  ring_start    TIMESTAMPTZ,
  ring_end      TIMESTAMPTZ,
  ring_seconds  INT,
  talk_start    TIMESTAMPTZ,
  talk_end      TIMESTAMPTZ,
  talk_seconds  INT,
  missed        BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ah_call   ON agent_history (call_uuid, created_at);
CREATE INDEX IF NOT EXISTS idx_ah_agent  ON agent_history (agent_id, created_at DESC);

-- 3. Add computed columns to calls table for fast CDR queries
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ring_seconds      INT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS abandoned_seconds INT;

-- ============================================================
-- Seed default users
-- Passwords below are bcrypt-hashed.  To regenerate:
--   node -e "import('bcryptjs').then(b=>b.default.hash('YourPass',10).then(console.log))"
--
-- admin   / admin123
-- supervisor / super123
-- CHANGE THESE IMMEDIATELY in production.
-- ============================================================
-- These will be inserted by the seed script (scripts/seedUsers.js).
-- Run:  node backend/scripts/seedUsers.js
