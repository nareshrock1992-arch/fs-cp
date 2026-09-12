import bcrypt from 'bcryptjs';
import jwt    from 'jsonwebtoken';
import { query }      from '../db/pool.js';
import { config }     from '../config/index.js';
import { cc, isConnected } from '../services/eslService.js';
import * as agentSession from '../services/agentSessionService.js';
import { parsePagination, applyDateRange } from '../utils/queryHelpers.js';
import { businessTodayRange } from '../utils/timezone.js';

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
  // Includes the current break reason + authoritative server-side break start so
  // the Agent Desktop can render/restore the break timer across reloads without
  // trusting a client clock. break_name is the CURRENT configured name (live
  // break); historical snapshots come from agent_state_events instead.
  const { rows } = await query(
    `SELECT a.agent_id, a.full_name, a.avaya_extension, a.contact, a.status, a.state, a.updated_at,
            a.break_code, a.break_started_at, bc.name AS break_name
       FROM agents a
       LEFT JOIN break_codes bc ON bc.code = a.break_code
      WHERE a.agent_id = $1`,
    [req.agentId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });
  res.json(rows[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agent-desk/status
// ─────────────────────────────────────────────────────────────────────────────

// The three base agent statuses. These are NOT break codes — break codes are a
// separate concept (the reason attached to an 'On Break' status). Kept as a
// constant (not DB-backed) per the approved design.
const VALID_STATUSES = ['Available', 'On Break', 'Logged Out'];

export async function agentSetStatus(req, res) {
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  // ── Optional break reason (backward compatible) ──────────────────────────
  // Existing clients POST { status:'On Break' } with no code — still accepted.
  // New clients may POST { status:'On Break', break_code:'COFFEE' }. When a code
  // is supplied it MUST resolve to an active, agent-selectable break code; its
  // display name is snapshotted onto the state event at break time.
  let breakInfo = null;
  const rawCode = req.body?.break_code;
  if (status === 'On Break' && rawCode != null && String(rawCode).trim() !== '') {
    const code = String(rawCode).trim().toUpperCase();
    const { rows } = await query(
      `SELECT code, name FROM break_codes
        WHERE code = $1 AND active = true AND agent_selectable = true`,
      [code]
    );
    if (!rows[0]) {
      return res.status(400).json({ error: 'Invalid, inactive, or non-selectable break code' });
    }
    breakInfo = { break_code: rows[0].code, break_name: rows[0].name };
  }

  try { await cc.agentSetStatus(req.agentId, status); } catch { /* ESL offline — DB is still updated */ }

  // Reflect current break reason on the agent row: set when entering a coded
  // break, clear whenever the agent is not on a coded break.
  await query(
    `UPDATE agents
        SET status           = $2,
            break_code       = $3::varchar,
            break_started_at = CASE WHEN $3::varchar IS NULL THEN NULL ELSE now() END,
            updated_at       = now()
      WHERE agent_id = $1`,
    [req.agentId, status, breakInfo?.break_code ?? null]
  );
  await query(
    `INSERT INTO agent_state_log (agent_id, status, reason, break_code) VALUES ($1,$2,'agent_self',$3)`,
    [req.agentId, status, breakInfo?.break_code ?? null]
  );
  try { await agentSession.handleStatusTransition(req.agentId, status, 'agent_self', breakInfo); }
  catch (err) { console.error('[sessions] agentSetStatus transition failed:', err.message); }

  if (breakInfo) {
    console.log(`[break] ${req.agentId} On Break (${breakInfo.break_code})`);
  }

  res.json({ agent_id: req.agentId, status, break_code: breakInfo?.break_code ?? null,
             break_name: breakInfo?.break_name ?? null });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-desk/break-codes
// Active, agent-selectable break codes for the break selector. Never exposes
// inactive or non-selectable codes to agents.
// ─────────────────────────────────────────────────────────────────────────────

export async function agentBreakCodes(_req, res) {
  const { rows } = await query(
    `SELECT code, name, description, color, icon,
            max_duration_seconds, warn_threshold_seconds
       FROM break_codes
      WHERE active = true AND agent_selectable = true
      ORDER BY display_order ASC, name ASC`
  );
  res.json(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-desk/break-history
// The authenticated agent's own break history (agent_state_events, On Break),
// server-side paginated. Scope is ALWAYS req.agentId — an agent can never read
// another agent's history.
//   query: page, limit, start_date, end_date, break_code
// ─────────────────────────────────────────────────────────────────────────────

export async function agentBreakHistory(req, res) {
  const { page, limit, offset } = parsePagination(req.query);
  const params = [req.agentId];
  const conds  = [`agent_id = $1`, `status = 'On Break'`];

  const range = applyDateRange(req.query, params, 'started_at');
  conds.push(...range);

  if (req.query.break_code) {
    params.push(String(req.query.break_code).trim().toUpperCase());
    conds.push(`break_code = $${params.length}`);
  }

  const where = `WHERE ${conds.join(' AND ')}`;
  const totalQ = await query(`SELECT COUNT(*)::INT AS total FROM agent_state_events ${where}`, params);

  params.push(limit, offset);
  const { rows } = await query(
    `SELECT id, break_code, break_name, started_at, ended_at,
            COALESCE(duration_seconds,
              CASE WHEN ended_at IS NULL
                   THEN EXTRACT(EPOCH FROM (now() - started_at))::INT END) AS duration_seconds,
            (ended_at IS NULL) AS is_open, source
       FROM agent_state_events
       ${where}
       ORDER BY started_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ data: rows, page, limit, total: totalQ.rows[0].total });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-desk/call-history
// The authenticated agent's own call history over the existing calls +
// agent_history tables (no new capture). Server-side paginated + filtered.
//   query: page, limit, start_date, end_date, direction, disposition, search
// ─────────────────────────────────────────────────────────────────────────────

export async function agentCallHistory(req, res) {
  const { page, limit, offset } = parsePagination(req.query);
  const params = [req.agentId];
  const conds  = [`c.agent_id = $1`];

  conds.push(...applyDateRange(req.query, params, 'c.start_time'));

  if (req.query.direction && ['inbound', 'outbound'].includes(req.query.direction)) {
    params.push(req.query.direction);
    conds.push(`c.direction = $${params.length}`);
  }
  if (req.query.disposition) {
    params.push(String(req.query.disposition).trim());
    conds.push(`c.disposition = $${params.length}`);
  }
  if (req.query.search && String(req.query.search).trim() !== '') {
    params.push(`%${String(req.query.search).trim()}%`);
    const p = `$${params.length}`;
    conds.push(`(c.ani ILIKE ${p} OR c.dnis ILIKE ${p} OR c.call_uuid ILIKE ${p})`);
  }

  const where = `WHERE ${conds.join(' AND ')}`;
  const totalQ = await query(`SELECT COUNT(*)::INT AS total FROM calls c ${where}`, params);

  params.push(limit, offset);
  const { rows } = await query(
    `SELECT
        c.call_uuid, c.direction, c.ani, c.dnis, c.queue_name, c.agent_id,
        c.start_time, c.queue_enter_time, c.agent_answer_time, c.end_time,
        c.wait_seconds, c.talk_seconds, c.abandoned, c.disposition,
        ah.ring_seconds, ah.talk_seconds AS agent_talk_seconds, ah.missed
       FROM calls c
       LEFT JOIN agent_history ah
              ON ah.call_uuid = c.call_uuid AND ah.agent_id = c.agent_id
       ${where}
       ORDER BY c.start_time DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ data: rows, page, limit, total: totalQ.rows[0].total });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-desk/call-history/:callUuid
// Detail for one call — scoped to the authenticated agent (agent can only open
// calls they were part of).
// ─────────────────────────────────────────────────────────────────────────────

export async function agentCallHistoryDetail(req, res) {
  const callUuid = String(req.params.callUuid || '').trim();
  if (!callUuid) return res.status(400).json({ error: 'call id is required' });

  const { rows } = await query(
    `SELECT
        c.call_uuid, c.direction, c.ani, c.dnis, c.vdn, c.queue_name, c.agent_id,
        c.start_time, c.queue_enter_time, c.agent_answer_time, c.end_time,
        c.wait_seconds, c.talk_seconds, c.abandoned, c.disposition,
        ah.ring_start, ah.ring_end, ah.ring_seconds,
        ah.talk_start, ah.talk_end, ah.talk_seconds AS agent_talk_seconds, ah.missed,
        EXTRACT(EPOCH FROM (c.end_time - c.start_time))::INT AS total_seconds
       FROM calls c
       LEFT JOIN agent_history ah
              ON ah.call_uuid = c.call_uuid AND ah.agent_id = c.agent_id
      WHERE c.call_uuid = $1 AND c.agent_id = $2`,
    [callUuid, req.agentId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Call not found' });
  res.json(rows[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-desk/queues
// Queues this agent belongs to, with:
//   • live call stats (LATERAL cs)
//   • per-queue agent availability counts (LATERAL ag)
// ─────────────────────────────────────────────────────────────────────────────

export async function agentQueues(req, res) {
  const { fromUTC, toUTC } = businessTodayRange();
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

        COUNT(*) FILTER (WHERE (c.start_time >= $2 AND c.start_time < $3))::INT            AS offered_today,
        COUNT(*) FILTER (WHERE (c.start_time >= $2 AND c.start_time < $3)
                          AND c.disposition = 'answered')::INT               AS answered_today,
        COUNT(*) FILTER (WHERE (c.start_time >= $2 AND c.start_time < $3)
                          AND c.abandoned = true)::INT                       AS abandoned_today,

        COALESCE(AVG(c.wait_seconds) FILTER (
          WHERE (c.start_time >= $2 AND c.start_time < $3) AND c.disposition = 'answered'
        ), 0)::INT AS avg_wait_today,

        COALESCE(
          100.0
          * COUNT(*) FILTER (
              WHERE (c.start_time >= $2 AND c.start_time < $3)
                AND c.disposition = 'answered'
                AND c.wait_seconds <= q.max_wait_time
            )
          / NULLIF(
              COUNT(*) FILTER (WHERE (c.start_time >= $2 AND c.start_time < $3) AND c.disposition = 'answered') +
              COUNT(*) FILTER (WHERE (c.start_time >= $2 AND c.start_time < $3) AND c.abandoned = true),
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
  `, [req.agentId, fromUTC.toISOString(), toUTC.toISOString()]);

  res.json(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-desk/calls
// Today's calls handled by this agent. Active call is the first row where
// end_time IS NULL.
// ─────────────────────────────────────────────────────────────────────────────

export async function agentCalls(req, res) {
  const { fromUTC, toUTC } = businessTodayRange();
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
      AND start_time >= $2 AND start_time < $3
    ORDER BY start_time DESC
    LIMIT 20
  `, [req.agentId, fromUTC.toISOString(), toUTC.toISOString()]);

  res.json(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agent-desk/performance
// Today's performance metrics for the logged-in agent.
// Uses agent_history (ring/talk data per call-agent pair) + calls + state_log.
// ─────────────────────────────────────────────────────────────────────────────

export async function agentPerformance(req, res) {
  const { fromUTC, toUTC } = businessTodayRange();
  const day = [req.agentId, fromUTC.toISOString(), toUTC.toISOString()];
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
        AND created_at >= $2 AND created_at < $3
    `, day),

    // ── From agent_state_log: status transitions today ───────────────────
    query(`
      SELECT status, COUNT(*)::INT AS transitions
      FROM agent_state_log
      WHERE agent_id = $1
        AND changed_at >= $2 AND changed_at < $3
        AND status IS NOT NULL
      GROUP BY status
      ORDER BY status
    `, day),
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
// GET /api/agent-desk/esl-status
// Returns current FreeSWITCH ESL connection state. Called by the Agent Desktop
// on every Socket.IO connect/reconnect so the UI re-syncs after any outage
// without requiring a browser refresh.
// ─────────────────────────────────────────────────────────────────────────────

export function eslStatus(_req, res) {
  res.json({ connected: isConnected() });
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
