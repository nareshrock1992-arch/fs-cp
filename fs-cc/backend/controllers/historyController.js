import { query } from '../db/pool.js';
import { parsePagination, applyDateRange } from '../utils/queryHelpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Supervisor / Admin history APIs.
//
// Mounted under /api/reports (behind requirePermission('view_reports') in the
// reports router). Unlike the agent-scoped endpoints, staff may filter across
// agents. Reuses the same underlying tables (agent_state_events, calls,
// agent_history) — no duplicate data source.
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/reports/break-history
//   query: page, limit, start_date, end_date, agent, break_code
export async function supervisorBreakHistory(req, res) {
  const { page, limit, offset } = parsePagination(req.query);
  const params = [];
  const conds  = [`e.status = 'On Break'`];

  conds.push(...applyDateRange(req.query, params, 'e.started_at'));

  if (req.query.agent) {
    params.push(String(req.query.agent).trim());
    conds.push(`e.agent_id = $${params.length}`);
  }
  if (req.query.break_code) {
    params.push(String(req.query.break_code).trim().toUpperCase());
    conds.push(`e.break_code = $${params.length}`);
  }

  const where  = `WHERE ${conds.join(' AND ')}`;
  const totalQ = await query(`SELECT COUNT(*)::INT AS total FROM agent_state_events e ${where}`, params);

  params.push(limit, offset);
  const { rows } = await query(
    `SELECT
        e.id, e.agent_id, a.full_name, e.break_code, e.break_name,
        e.started_at, e.ended_at,
        COALESCE(e.duration_seconds,
          CASE WHEN e.ended_at IS NULL
               THEN EXTRACT(EPOCH FROM (now() - e.started_at))::INT END) AS duration_seconds,
        (e.ended_at IS NULL) AS is_open, e.source
       FROM agent_state_events e
       LEFT JOIN agents a ON a.agent_id = e.agent_id
       ${where}
       ORDER BY e.started_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ data: rows, page, limit, total: totalQ.rows[0].total });
}

// GET /api/reports/call-history
//   query: page, limit, start_date, end_date, agent, queue, direction,
//          disposition, search
export async function supervisorCallHistory(req, res) {
  const { page, limit, offset } = parsePagination(req.query);
  const params = [];
  const conds  = [];

  conds.push(...applyDateRange(req.query, params, 'c.start_time'));

  if (req.query.agent) {
    params.push(String(req.query.agent).trim());
    conds.push(`c.agent_id = $${params.length}`);
  }
  if (req.query.queue) {
    params.push(String(req.query.queue).trim());
    conds.push(`c.queue_name = $${params.length}`);
  }
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

  const where  = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const totalQ = await query(`SELECT COUNT(*)::INT AS total FROM calls c ${where}`, params);

  params.push(limit, offset);
  const { rows } = await query(
    `SELECT
        c.call_uuid, c.direction, c.ani, c.dnis, c.queue_name, c.agent_id,
        c.start_time, c.queue_enter_time, c.agent_answer_time, c.end_time,
        c.wait_seconds, c.talk_seconds, c.abandoned, c.disposition
       FROM calls c
       ${where}
       ORDER BY c.start_time DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ data: rows, page, limit, total: totalQ.rows[0].total });
}
