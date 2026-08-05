-- ── Agent Desktop: add PIN auth + no_answer_delay_time ──────────────────────
-- Agents log in to the Agent Desktop with their agent_id + a PIN.
-- Admins set PINs via POST /api/agents/:id/set-pin.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS no_answer_delay_time INT NOT NULL DEFAULT 10;
