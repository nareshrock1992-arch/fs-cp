-- ============================================================
-- FreeSWITCH Contact Center - reporting & config database
-- This DB is the "source of truth" the admin UI reads/writes.
-- A sync job (services/eslService.js) keeps mod_callcenter's
-- in-memory config aligned with these tables, and call/agent
-- events from FreeSWITCH are written back here for reporting.
-- ============================================================

CREATE TABLE IF NOT EXISTS queues (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(64) UNIQUE NOT NULL,        -- e.g. support@default
  display_name    VARCHAR(128) NOT NULL,
  strategy        VARCHAR(32)  NOT NULL DEFAULT 'longest-idle-agent',
  moh_sound       VARCHAR(255) DEFAULT 'local_stream://moh',
  max_wait_time         INT NOT NULL DEFAULT 300,      -- seconds, 0 = unlimited
  max_wait_time_w_no_agent INT NOT NULL DEFAULT 0,
  max_queue_size        INT NOT NULL DEFAULT 50,
  record_calls    BOOLEAN NOT NULL DEFAULT true,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id                SERIAL PRIMARY KEY,
  agent_id          VARCHAR(64) UNIQUE NOT NULL,        -- e.g. agent_1001 (FreeSWITCH agent name)
  full_name         VARCHAR(128) NOT NULL,
  avaya_extension   VARCHAR(32)  NOT NULL,               -- e.g. 5001
  contact           VARCHAR(255) NOT NULL,               -- sofia/gateway/avaya_gw/5001
  status            VARCHAR(32)  NOT NULL DEFAULT 'Logged Out',
  -- Available | On Break | Logged Out
  state             VARCHAR(32)  NOT NULL DEFAULT 'Logged Out',
  -- Waiting | Receiving | In a queue call | Idle | Logged Out
  max_no_answer     INT NOT NULL DEFAULT 3,
  wrap_up_time      INT NOT NULL DEFAULT 20,
  reject_delay_time INT NOT NULL DEFAULT 2,
  busy_delay_time   INT NOT NULL DEFAULT 60,
  no_answer_delay_time INT NOT NULL DEFAULT 10,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_tiers (
  id          SERIAL PRIMARY KEY,
  agent_id    INT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  queue_id    INT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  level       INT NOT NULL DEFAULT 1,    -- lower level = tried first
  position    INT NOT NULL DEFAULT 1,    -- tie-break ordering within a level
  UNIQUE (agent_id, queue_id)
);

CREATE TABLE IF NOT EXISTS agent_state_log (
  id          BIGSERIAL PRIMARY KEY,
  agent_id    VARCHAR(64) NOT NULL,
  status      VARCHAR(32),
  state       VARCHAR(32),
  reason      VARCHAR(128),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_state_log_agent_time ON agent_state_log (agent_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS calls (
  id                 BIGSERIAL PRIMARY KEY,
  call_uuid          VARCHAR(64) UNIQUE NOT NULL,
  ani                VARCHAR(32),
  dnis               VARCHAR(32),
  vdn                VARCHAR(32),
  ivr_option         VARCHAR(32),
  queue_name         VARCHAR(64),
  agent_id           VARCHAR(64),
  start_time         TIMESTAMPTZ NOT NULL DEFAULT now(),
  queue_enter_time   TIMESTAMPTZ,
  agent_answer_time  TIMESTAMPTZ,
  end_time           TIMESTAMPTZ,
  wait_seconds       INT,
  talk_seconds       INT,
  abandoned          BOOLEAN NOT NULL DEFAULT false,
  disposition        VARCHAR(32)   -- answered | abandoned | overflow | no_agent
);
CREATE INDEX IF NOT EXISTS idx_calls_queue_time ON calls (queue_name, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_calls_agent_time ON calls (agent_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_calls_start_time ON calls (start_time DESC);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_queues_updated_at ON queues;
CREATE TRIGGER trg_queues_updated_at BEFORE UPDATE ON queues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_agents_updated_at ON agents;
CREATE TRIGGER trg_agents_updated_at BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed a couple of example queues/agents so the UI has something to show on first run.
INSERT INTO queues (name, display_name, strategy, max_wait_time, max_queue_size)
VALUES
  ('support@default', 'Support', 'longest-idle-agent', 300, 50),
  ('sales@default',   'Sales',   'longest-idle-agent', 180, 30)
ON CONFLICT (name) DO NOTHING;
