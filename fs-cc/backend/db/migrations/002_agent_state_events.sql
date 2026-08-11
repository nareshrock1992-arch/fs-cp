-- Migration 002: agent_state_events
-- Tracks one row per contiguous status segment (Available | On Break) within a session.
-- 'Logged Out' is NOT stored here — it is the session boundary, not a state within a session.
-- At most one open event per agent enforced by the partial unique index.

CREATE TABLE IF NOT EXISTS agent_state_events (
  id               BIGSERIAL PRIMARY KEY,
  agent_id         VARCHAR(64) NOT NULL,
  session_id       BIGINT,
  status           VARCHAR(32) NOT NULL CHECK (status IN ('Available', 'On Break')),
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  duration_seconds INT,
  source           VARCHAR(32) NOT NULL
                   CHECK (source IN ('fs_event', 'agent_self', 'manual', 'reconciliation')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Report queries: agent + date range
CREATE INDEX IF NOT EXISTS idx_ase_agent_started
  ON agent_state_events (agent_id, started_at DESC);

-- Dedup + reconciliation: find the open event for an agent
CREATE UNIQUE INDEX IF NOT EXISTS idx_ase_one_open
  ON agent_state_events (agent_id)
  WHERE ended_at IS NULL;

-- Session join: all events for a given session
CREATE INDEX IF NOT EXISTS idx_ase_session
  ON agent_state_events (session_id)
  WHERE session_id IS NOT NULL;

-- Report aggregation: filter by status within a date range
CREATE INDEX IF NOT EXISTS idx_ase_agent_status_range
  ON agent_state_events (agent_id, status, started_at DESC);
