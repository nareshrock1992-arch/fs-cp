import bcrypt from 'bcryptjs';
import jwt    from 'jsonwebtoken';
import { query }  from '../db/pool.js';
import { config } from '../config/index.js';
import { cc }     from '../services/eslService.js';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agent-desk/login
// ─────────────────────────────────────────────────────────────────────────────

export async function agentLogin(req, res) {
  const { agent_id, pin } = req.body || {};
  if (!agent_id || !pin) {
    return res.status(400).json({ error: 'agent_id and pin are required' });
  }

  const { rows } = await query(
    `SELECT id, agent_id, full_name, avaya_extension, contact, status, state, pin_hash
     FROM agents WHERE agent_id = $1 AND active = true`,
    [String(agent_id).trim()]
  );

  const agent = rows[0];
  if (!agent) return res.status(401).json({ error: 'Invalid credentials' });
  if (!agent.pin_hash) {
    return res.status(401).json({ error: 'No PIN set — ask your supervisor to set one via the Admin UI' });
  }

  const valid = await bcrypt.compare(String(pin), agent.pin_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { agentId: agent.agent_id, fullName: agent.full_name, role: 'agent' },
    config.jwt.secret,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    agent: {
      agent_id:        agent.agent_id,
      full_name:       agent.full_name,
      avaya_extension: agent.avaya_extension,
      contact:         agent.contact,
      status:          agent.status,
      state:           agent.state,
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-desk/me
// ─────────────────────────────────────────────────────────────────────────────

export async function agentMe(req, res) {
  const { rows } = await query(
    `SELECT agent_id, full_name, avaya_extension, contact, status, state, updated_at
     FROM agents WHERE agent_id = $1`,
    [req.agentId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });
  res.json(rows[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agent-desk/status
// ─────────────────────────────────────────────────────────────────────────────

const VALID_STATUSES = ['Available', 'On Break', 'Logged Out'];

export async function agentSetStatus(req, res) {
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  try { await cc.agentSetStatus(req.agentId, status); } catch { /* ESL offline — DB is still updated */ }

  await query(
    `UPDATE agents SET status = $2, updated_at = now() WHERE agent_id = $1`,
    [req.agentId, status]
  );
  await query(
    `INSERT INTO agent_state_log (agent_id, status, reason) VALUES ($1,$2,'agent_self')`,
    [req.agentId, status]
  );

  res.json({ agent_id: req.agentId, status });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-desk/queues
// Queues this agent belongs to, with:
//   • live call stats (LATERAL cs)
//   • per-queue agent availability counts (LATERAL ag)
// ─────────────────────────────────────────────────────────────────────────────

export async function agentQueues(req, res) {
  const { rows } = await query(`
    SELECT
      q.name,
      q.display_name,
      q.strategy,
      q.max_wait_time,
      t.level,
      t.position,

      -- ── Live call metrics ─────────────────────────────────────────────────
      cs.waiting,
      cs.active,
      cs.offered_today,
      cs.answered_today,
      cs.abandoned_today,
      cs.avg_wait_today,
      cs.sla_pct_today,
      cs.longest_wait_seconds,

      -- ── Per-queue agent availability ──────────────────────────────────────
      ag.total_agents,
      ag.available_agents,
      ag.on_break_agents,
      ag.logged_out_agents

    FROM queues q
    JOIN agent_tiers t  ON t.queue_id  = q.id
    JOIN agents     a   ON a.id        = t.agent_id
                      AND a.agent_id   = $1

    -- ── LATERAL 1: call stats ─────────────────────────────────────────────
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (
          WHERE c.end_time IS NULL AND c.agent_id IS NULL
            AND c.disposition = 'waiting'
            AND c.start_time > now() - interval '6 hours'
        )::INT AS waiting,

        COUNT(*) FILTER (
          WHERE c.end_time IS NULL AND c.agent_id IS NOT NULL
            AND c.disposition = 'answered'
            AND c.start_time > now() - interval '6 hours'
        )::INT AS active,

        COUNT(*) FILTER (WHERE c.start_time >= CURRENT_DATE)::INT            AS offered_today,
        COUNT(*) FILTER (WHERE c.start_time >= CURRENT_DATE
                          AND c.disposition = 'answered')::INT               AS answered_today,
        COUNT(*) FILTER (WHERE c.start_time >= CURRENT_DATE
                          AND c.abandoned = true)::INT                       AS abandoned_today,

        COALESCE(AVG(c.wait_seconds) FILTER (
          WHERE c.start_time >= CURRENT_DATE AND c.disposition = 'answered'
        ), 0)::INT AS avg_wait_today,

        COALESCE(
          100.0
          * COUNT(*) FILTER (
              WHERE c.start_time >= CURRENT_DATE
                AND c.disposition = 'answered'
                AND c.wait_seconds <= q.max_wait_time
            )
          / NULLIF(
              COUNT(*) FILTER (WHERE c.start_time >= CURRENT_DATE AND c.disposition = 'answered') +
              COUNT(*) FILTER (WHERE c.start_time >= CURRENT_DATE AND c.abandoned = true),
              0),
          0
        )::NUMERIC(5,1) AS sla_pct_today,

        COALESCE(MAX(
          EXTRACT(EPOCH FROM (now() - c.queue_enter_time))::INT
        ) FILTER (WHERE c.end_time IS NULL AND c.agent_id IS NULL), 0) AS longest_wait_seconds

      FROM calls c
      WHERE c.queue_name = q.name
    ) cs ON true

    -- ── LATERAL 2: agent counts for this queue ────────────────────────────
    LEFT JOIN LATERAL (
      SELECT
        COUNT(a2.id)::INT                                                    AS total_agents,
        COUNT(a2.id) FILTER (WHERE a2.status = 'Available')::INT            AS available_agents,
        COUNT(a2.id) FILTER (WHERE a2.status = 'On Break')::INT             AS on_break_agents,
        COUNT(a2.id) FILTER (WHERE a2.status = 'Logged Out')::INT           AS logged_out_agents
      FROM agent_tiers t2
      JOIN agents a2 ON a2.id = t2.agent_id
      WHERE t2.queue_id = q.id AND a2.active = true
    ) ag ON true

    WHERE q.active = true
    ORDER BY t.level, t.position, q.display_name
  `, [req.agentId]);

  res.json(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-desk/calls
// Today's calls handled by this agent. Active call is the first row where
// end_time IS NULL.
// ─────────────────────────────────────────────────────────────────────────────

export async function agentCalls(req, res) {
  const { rows } = await query(`
    SELECT
      call_uuid, ani, dnis, queue_name,
      start_time, queue_enter_time, agent_answer_time, end_time,
      wait_seconds, talk_seconds, disposition, abandoned,
      CASE
        WHEN end_time IS NULL THEN
          EXTRACT(EPOCH FROM (now() - COALESCE(agent_answer_time, queue_enter_time, start_time)))::INT
        ELSE NULL
      END AS elapsed_seconds
    FROM calls
    WHERE agent_id = $1
      AND start_time >= CURRENT_DATE
    ORDER BY start_time DESC
    LIMIT 20
  `, [req.agentId]);

  res.json(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-desk/performance
// Today's performance metrics for the logged-in agent.
// Uses agent_history (ring/talk data per call-agent pair) + calls + state_log.
// ─────────────────────────────────────────────────────────────────────────────

export async function agentPerformance(req, res) {
  const [ahRows, stateRows] = await Promise.all([
    // ── From agent_history: talk/ring stats ───────────────────────────────
    query(`
      SELECT
        COUNT(*) FILTER (WHERE missed = false AND talk_start IS NOT NULL)::INT
          AS calls_handled,
        COUNT(*) FILTER (WHERE missed = true)::INT
          AS calls_missed,
        COALESCE(
          AVG(talk_seconds) FILTER (WHERE missed = false AND talk_seconds > 0),
          0
        )::INT AS avg_talk_seconds,
        COALESCE(
          SUM(talk_seconds) FILTER (WHERE missed = false AND talk_seconds > 0),
          0
        )::INT AS total_talk_seconds,
        COALESCE(
          AVG(ring_seconds) FILTER (WHERE missed = true AND ring_seconds > 0),
          0
        )::INT AS avg_ring_seconds_missed
      FROM agent_history
      WHERE agent_id = $1
        AND created_at >= CURRENT_DATE
    `, [req.agentId]),

    // ── From agent_state_log: status transitions today ───────────────────
    query(`
      SELECT status, COUNT(*)::INT AS transitions
      FROM agent_state_log
      WHERE agent_id = $1
        AND changed_at >= CURRENT_DATE
        AND status IS NOT NULL
      GROUP BY status
      ORDER BY status
    `, [req.agentId]),
  ]);

  const perf = ahRows.rows[0] || {
    calls_handled: 0, calls_missed: 0,
    avg_talk_seconds: 0, total_talk_seconds: 0, avg_ring_seconds_missed: 0,
  };

  // Derive AHT (Average Handle Time = avg talk + typical wrap-up proxy)
  // We only have talk_seconds here; wait_seconds are on the calls row.
  res.json({
    ...perf,
    status_log: stateRows.rows,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agents/:agentId/set-pin   (admin-only, called from Admin Agents UI)
// ─────────────────────────────────────────────────────────────────────────────

export async function setAgentPin(req, res) {
  const { agentId } = req.params;
  const { pin }     = req.body || {};

  if (!pin || String(pin).trim().length < 4) {
    return res.status(400).json({ error: 'PIN must be at least 4 characters' });
  }

  const hash = await bcrypt.hash(String(pin).trim(), 10);
  const { rowCount } = await query(
    `UPDATE agents SET pin_hash = $2 WHERE agent_id = $1`,
    [agentId, hash]
  );
  if (!rowCount) return res.status(404).json({ error: 'Agent not found' });

  res.json({ ok: true, message: `PIN updated for ${agentId}` });
}
