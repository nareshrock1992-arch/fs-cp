-- ============================================================
-- Performance indexes migration
-- Run once: psql -U fs_cc -d fs_cc -f migrate_indexes.sql
-- ============================================================

-- calls: live-call queries filter on end_time IS NULL constantly
CREATE INDEX IF NOT EXISTS idx_calls_open
  ON calls (queue_name, start_time DESC)
  WHERE end_time IS NULL;

-- calls: ghost-reaper WHERE end_time IS NULL AND start_time < X
CREATE INDEX IF NOT EXISTS idx_calls_end_time
  ON calls (end_time, start_time);

-- calls: CDR queries filter on abandoned = true
CREATE INDEX IF NOT EXISTS idx_calls_abandoned
  ON calls (queue_name, abandoned, start_time DESC)
  WHERE abandoned = true;

-- calls: disposition filter used in stats queries
CREATE INDEX IF NOT EXISTS idx_calls_disposition_queue
  ON calls (queue_name, disposition, start_time DESC);

-- agent_history: CDR correlated subquery WHERE call_uuid = ? AND missed = true
CREATE INDEX IF NOT EXISTS idx_ah_missed
  ON agent_history (call_uuid)
  WHERE missed = true;

-- agent_history: agent performance report WHERE ring_start BETWEEN x AND y
CREATE INDEX IF NOT EXISTS idx_ah_ring_start
  ON agent_history (ring_start DESC);

-- agent_state_log: already indexed on (agent_id, changed_at DESC) — no change needed

-- queues: frequently joined by name
CREATE INDEX IF NOT EXISTS idx_queues_name_active
  ON queues (name)
  WHERE active = true;

-- agents: frequently joined by agent_id
CREATE INDEX IF NOT EXISTS idx_agents_agent_id_active
  ON agents (agent_id)
  WHERE active = true;
