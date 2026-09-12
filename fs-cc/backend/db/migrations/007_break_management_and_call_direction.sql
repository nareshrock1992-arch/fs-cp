-- ── Phase: Break Management + Call History enhancements ─────────────────────
-- Adds:
--   1. break_codes            — supervisor-configurable break reasons (business data)
--   2. break reason columns   — on agents (current break) + agent_state_events (history)
--   3. calls.direction        — inbound/outbound, forward-compatible (default 'inbound')
--   4. audit_log              — minimal audit trail for break-code configuration changes
--
-- Design notes (consistent with existing fs-cc conventions):
--   • break_code is stored as VARCHAR + a break_name snapshot on history rows, with
--     NO hard FK — identical to how calls.queue_name / calls.agent_id are plain
--     varchars. This guarantees historical break/agent-state records remain valid
--     even after a break code is deactivated or renamed (RULE 2).
--   • The application is single-tenant (no tenant_id exists anywhere in the current
--     schema), so no tenant column is introduced (no unnecessary architecture change).
--   • Break history reuses the existing agent_state_events table (status='On Break')
--     rather than creating a second, conflicting state system (RULE: reuse).
--
-- IMPORTANT: no BEGIN/COMMIT here — the migration runner wraps this file in a
-- single transaction. All statements are idempotent (IF NOT EXISTS / DO $$ / ON
-- CONFLICT) so the file is safe to re-run and safe on fresh + existing databases.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. break_codes — configurable break reasons ──────────────────────────────
CREATE TABLE IF NOT EXISTS break_codes (
  id                     SERIAL PRIMARY KEY,
  code                   VARCHAR(64)  UNIQUE NOT NULL,   -- e.g. COFFEE, LUNCH (safe format)
  name                   VARCHAR(128) NOT NULL,
  description            TEXT,
  active                 BOOLEAN NOT NULL DEFAULT true,
  display_order          INT     NOT NULL DEFAULT 0,
  color                  VARCHAR(16),                    -- optional hex, e.g. #3B82F6
  icon                   VARCHAR(64),                    -- optional icon name
  agent_selectable       BOOLEAN NOT NULL DEFAULT true,  -- agents may pick it
  max_duration_seconds   INT,                            -- optional cap
  warn_threshold_seconds INT,                            -- optional warning point
  created_by             VARCHAR(128),
  updated_by             VARCHAR(128),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agents fetch active, selectable codes ordered by display_order.
CREATE INDEX IF NOT EXISTS idx_break_codes_active_order
  ON break_codes (active, display_order, name);

-- Reuse the shared updated_at trigger defined in schema.sql.
DROP TRIGGER IF EXISTS trg_break_codes_updated_at ON break_codes;
CREATE TRIGGER trg_break_codes_updated_at BEFORE UPDATE ON break_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. Break reason on the agent (current break) ─────────────────────────────
ALTER TABLE agents ADD COLUMN IF NOT EXISTS break_code       VARCHAR(64);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS break_started_at TIMESTAMPTZ;

-- ── 2b. Break reason on the state-event history (snapshot preserved) ──────────
ALTER TABLE agent_state_events ADD COLUMN IF NOT EXISTS break_code VARCHAR(64);
ALTER TABLE agent_state_events ADD COLUMN IF NOT EXISTS break_name VARCHAR(128);

-- Report/history queries by break code within a range.
CREATE INDEX IF NOT EXISTS idx_ase_break_code
  ON agent_state_events (break_code, started_at DESC)
  WHERE break_code IS NOT NULL;

-- ── 2c. Break reason on the append-only state log (optional context) ──────────
ALTER TABLE agent_state_log ADD COLUMN IF NOT EXISTS break_code VARCHAR(64);

-- ── 3. Call direction (outbound-ready; existing rows are inbound) ─────────────
ALTER TABLE calls ADD COLUMN IF NOT EXISTS direction VARCHAR(16) NOT NULL DEFAULT 'inbound';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'calls_direction_check'
       AND conrelid = 'public.calls'::regclass
  ) THEN
    ALTER TABLE calls
      ADD CONSTRAINT calls_direction_check CHECK (direction IN ('inbound','outbound'));
  END IF;
END
$$;

-- Call-history filtering by agent + direction + recency (most-recent-first).
CREATE INDEX IF NOT EXISTS idx_calls_agent_dir_time
  ON calls (agent_id, direction, start_time DESC);

-- ── 4. audit_log — minimal, single audit trail (no existing mechanism) ───────
CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL PRIMARY KEY,
  actor        VARCHAR(128),                 -- user email / agent_id who acted
  actor_role   VARCHAR(32),                  -- admin | supervisor | agent
  action       VARCHAR(64)  NOT NULL,        -- e.g. break_code.create
  entity_type  VARCHAR(64)  NOT NULL,        -- e.g. break_code
  entity_id    VARCHAR(64),                  -- id/code of the affected entity
  old_value    JSONB,
  new_value    JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log (actor, created_at DESC);

-- ── 5. Starter break codes (editable seed data, NOT frontend constants) ──────
-- These are ordinary configuration rows a supervisor can edit/disable at any time.
-- Seeding keeps the Agent Desktop functional out-of-the-box (it previously had a
-- single implicit "Coffee" break). They are NOT hardcoded in the frontend.
INSERT INTO break_codes (code, name, description, display_order, max_duration_seconds, warn_threshold_seconds, created_by)
VALUES
  ('COFFEE',  'Coffee Break', 'Short refreshment break',        10, 900,  780,  'system_seed'),
  ('LUNCH',   'Lunch Break',  'Meal break',                     20, 3600, 3300, 'system_seed'),
  ('MEETING', 'Meeting',      'Team or one-on-one meeting',     30, NULL, NULL, 'system_seed'),
  ('TRAINING','Training',     'Training or coaching session',   40, NULL, NULL, 'system_seed'),
  ('OTHER',   'Other',        'Unspecified break reason',       99, NULL, NULL, 'system_seed')
ON CONFLICT (code) DO NOTHING;
