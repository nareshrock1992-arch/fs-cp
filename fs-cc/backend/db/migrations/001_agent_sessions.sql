-- Migration 001: agent_sessions
-- Tracks one row per contiguous login period per agent.
-- A session opens on any non-Logged-Out status when no active session exists.
-- A session closes only when status becomes 'Logged Out' (explicit or reconciliation).
-- No FK to agents — historical sessions must survive agent deletion (mirrors agent_history).

CREATE TABLE IF NOT EXISTS agent_sessions (
  id               BIGSERIAL PRIMARY KEY,
  agent_id         VARCHAR(64) NOT NULL,
  login_at         TIMESTAMPTZ NOT NULL,
  logout_at        TIMESTAMPTZ,
  duration_seconds INT,
  logout_reason    VARCHAR(32),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Report queries: agent performance in a date range
CREATE INDEX IF NOT EXISTS idx_agent_sessions_agent_login
  ON agent_sessions (agent_id, login_at DESC);

-- Reconciliation + dedup: fast lookup of the one open session per agent
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_sessions_one_open
  ON agent_sessions (agent_id)
  WHERE logout_at IS NULL;
