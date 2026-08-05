-- ============================================================
-- Reporting schema migration
-- Run once:  psql -U user -d db -f migrate_reporting.sql
-- ============================================================

-- 1. Widen columns that hold FreeSWITCH UUIDs (36 chars) or phone numbers
ALTER TABLE calls ALTER COLUMN call_uuid  TYPE VARCHAR(64);
ALTER TABLE calls ALTER COLUMN vdn        TYPE VARCHAR(64);
ALTER TABLE calls ALTER COLUMN ani        TYPE VARCHAR(64);
ALTER TABLE calls ALTER COLUMN dnis       TYPE VARCHAR(64);
ALTER TABLE calls ALTER COLUMN queue_name TYPE VARCHAR(64);
ALTER TABLE calls ALTER COLUMN agent_id   TYPE VARCHAR(64);

-- 2. IVR path as JSONB on the calls row
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ivr_path JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3. Useful indexes that the reporting queries need
CREATE INDEX IF NOT EXISTS idx_calls_ivr_path    ON calls USING gin (ivr_path);
CREATE INDEX IF NOT EXISTS idx_calls_disposition  ON calls (disposition, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_calls_live         ON calls (end_time) WHERE end_time IS NULL;
CREATE INDEX IF NOT EXISTS idx_calls_queue_date   ON calls (queue_name, start_time DESC);

-- 4. ivr_history — one row per IVR step per call (granular tracking)
CREATE TABLE IF NOT EXISTS ivr_history (
  id           BIGSERIAL PRIMARY KEY,
  call_uuid    VARCHAR(64) NOT NULL,
  vdn          VARCHAR(64),
  queue_name   VARCHAR(64),
  step_name    VARCHAR(128) NOT NULL,
  step_app     VARCHAR(64),
  digit        VARCHAR(4),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ivr_call  ON ivr_history (call_uuid, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ivr_step  ON ivr_history (step_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ivr_time  ON ivr_history (occurred_at DESC);

-- 5. queue_stats_hourly — incremented in real-time as calls complete
--    Used by the dashboard for fast live reads; avoids full-table scans on calls.
CREATE TABLE IF NOT EXISTS queue_stats_hourly (
  id                   BIGSERIAL PRIMARY KEY,
  queue_name           VARCHAR(64) NOT NULL,
  hour_bucket          TIMESTAMPTZ NOT NULL,   -- truncated to the hour
  offered              INT     NOT NULL DEFAULT 0,
  answered             INT     NOT NULL DEFAULT 0,
  abandoned            INT     NOT NULL DEFAULT 0,
  total_wait_seconds   BIGINT  NOT NULL DEFAULT 0,
  total_talk_seconds   BIGINT  NOT NULL DEFAULT 0,
  sla_count            INT     NOT NULL DEFAULT 0,   -- answered within threshold
  max_wait_seconds     INT     NOT NULL DEFAULT 0,
  UNIQUE (queue_name, hour_bucket)
);
CREATE INDEX IF NOT EXISTS idx_qsh_bucket ON queue_stats_hourly (queue_name, hour_bucket DESC);

-- 6. queue_stats_daily — rolled up from hourly once a day (or on demand)
CREATE TABLE IF NOT EXISTS queue_stats_daily (
  id                   BIGSERIAL PRIMARY KEY,
  queue_name           VARCHAR(64) NOT NULL,
  day_bucket           DATE        NOT NULL,
  offered              INT     NOT NULL DEFAULT 0,
  answered             INT     NOT NULL DEFAULT 0,
  abandoned            INT     NOT NULL DEFAULT 0,
  total_wait_seconds   BIGINT  NOT NULL DEFAULT 0,
  total_talk_seconds   BIGINT  NOT NULL DEFAULT 0,
  sla_count            INT     NOT NULL DEFAULT 0,
  max_wait_seconds     INT     NOT NULL DEFAULT 0,
  UNIQUE (queue_name, day_bucket)
);
CREATE INDEX IF NOT EXISTS idx_qsd_day ON queue_stats_daily (queue_name, day_bucket DESC);

-- 7. Backfill queue_stats_hourly from existing calls data
INSERT INTO queue_stats_hourly
  (queue_name, hour_bucket, offered, answered, abandoned,
   total_wait_seconds, total_talk_seconds, max_wait_seconds)
SELECT
  queue_name,
  date_trunc('hour', start_time)               AS hour_bucket,
  COUNT(*)::INT,
  COUNT(*) FILTER (WHERE disposition='answered')::INT,
  COUNT(*) FILTER (WHERE abandoned=true)::INT,
  COALESCE(SUM(wait_seconds),0)::BIGINT,
  COALESCE(SUM(talk_seconds),0)::BIGINT,
  COALESCE(MAX(wait_seconds),0)::INT
FROM calls
WHERE queue_name IS NOT NULL AND start_time IS NOT NULL
GROUP BY queue_name, date_trunc('hour', start_time)
ON CONFLICT (queue_name, hour_bucket) DO NOTHING;

-- 8. Backfill queue_stats_daily from hourly
INSERT INTO queue_stats_daily
  (queue_name, day_bucket, offered, answered, abandoned,
   total_wait_seconds, total_talk_seconds, max_wait_seconds)
SELECT
  queue_name,
  hour_bucket::DATE                AS day_bucket,
  SUM(offered)::INT,
  SUM(answered)::INT,
  SUM(abandoned)::INT,
  SUM(total_wait_seconds)::BIGINT,
  SUM(total_talk_seconds)::BIGINT,
  MAX(max_wait_seconds)::INT
FROM queue_stats_hourly
GROUP BY queue_name, hour_bucket::DATE
ON CONFLICT (queue_name, day_bucket) DO NOTHING;
