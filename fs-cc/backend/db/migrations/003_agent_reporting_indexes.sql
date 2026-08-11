-- Migration 003: additional indexes for Phase 2 agent reporting queries.
-- Complements the indexes created in 001 (agent_sessions) and 002 (agent_state_events).
-- All CREATE INDEX IF NOT EXISTS — safe to run on both fresh and existing databases.

-- ── agent_sessions ────────────────────────────────────────────────────────────

-- Cross-agent date-range scan: "all sessions that overlap June 2026"
-- Covers queries that do not filter by agent_id (e.g. summary of all agents).
CREATE INDEX IF NOT EXISTS idx_agent_sessions_login_range
  ON agent_sessions (login_at DESC);

-- Covering index for logout range filter (overlap query needs both bounds)
CREATE INDEX IF NOT EXISTS idx_agent_sessions_logout_range
  ON agent_sessions (logout_at DESC)
  WHERE logout_at IS NOT NULL;

-- ── agent_state_events ────────────────────────────────────────────────────────

-- Cross-agent date-range scan: "all state events that overlap this week"
CREATE INDEX IF NOT EXISTS idx_ase_started_range
  ON agent_state_events (started_at DESC);

-- Covering index for ended_at range filter
CREATE INDEX IF NOT EXISTS idx_ase_ended_range
  ON agent_state_events (ended_at DESC)
  WHERE ended_at IS NOT NULL;

-- ── agent_history ─────────────────────────────────────────────────────────────

-- Per-agent call report filtered by ring_start (date of offer).
-- The existing idx_ah_agent uses created_at; ring_start is the correct
-- field for "calls offered in this date range".
CREATE INDEX IF NOT EXISTS idx_ah_agent_ring
  ON agent_history (agent_id, ring_start DESC);

-- Cross-agent call report filtered by ring_start
CREATE INDEX IF NOT EXISTS idx_ah_ring_start
  ON agent_history (ring_start DESC);
