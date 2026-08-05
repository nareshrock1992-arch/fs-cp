-- ============================================================
-- CDR views: call_history, agent_history, queue_history
-- Run once:  psql -U your_user -d your_db -f migrate_cdr_views.sql
-- ============================================================

-- call_history: full call record, one row per call
CREATE OR REPLACE VIEW call_history AS
SELECT
  c.call_uuid,
  c.ani,
  c.dnis,
  c.vdn,
  c.queue_name,
  c.agent_id,
  c.ivr_path,
  c.start_time,
  c.queue_enter_time,
  c.agent_answer_time,
  c.end_time,
  c.wait_seconds,
  c.talk_seconds,
  c.abandoned,
  c.disposition
FROM calls c;

-- queue_history: queue leg details, enriched with queue display name + strategy
CREATE OR REPLACE VIEW queue_history AS
SELECT
  c.call_uuid,
  c.queue_name,
  COALESCE(q.display_name, c.queue_name) AS queue_display_name,
  q.strategy,
  q.max_wait_time                         AS queue_sla_threshold,
  c.queue_enter_time,
  c.agent_answer_time,
  c.end_time,
  c.wait_seconds,
  c.abandoned,
  c.disposition
FROM calls c
LEFT JOIN queues q ON q.name = c.queue_name
WHERE c.queue_name IS NOT NULL;
