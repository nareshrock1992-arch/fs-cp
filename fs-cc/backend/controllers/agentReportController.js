/**
 * Agent Report Controller — Phase 2
 *
 * HTTP handlers for the agent session / activity reporting endpoints.
 * All queries and calculations are in agentReportService.js.
 *
 * DATE RANGE CONTRACT
 * ────────────────────
 * All endpoints accept ISO-8601 query params:
 *   ?from=2026-06-01T00:00:00Z  (inclusive lower bound, UTC)
 *   ?to=2026-06-30T23:59:59Z    (inclusive upper bound, UTC)
 *
 * If omitted, defaults to the current calendar day in UTC (00:00:00–23:59:59).
 *
 * NOTE: The existing dateRange() in reportsController.js has a local-time
 * parsing bug. This controller uses utcDateRange() (defined here) which
 * always interprets bare dates as UTC midnight. Existing reports are untouched.
 */

import * as svc from '../services/agentReportService.js';

// ── Date range helper ────────────────────────────────────────────────────────

/**
 * Returns { from: Date, to: Date } parsed strictly as UTC.
 * Bare dates like "2026-06-01" are interpreted as "2026-06-01T00:00:00Z".
 * Full ISO strings with Z/offset are used as-is.
 *
 * Validates both params are valid dates; throws 400 if not.
 */
function utcDateRange(fromStr, toStr, res) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10); // "2026-08-10"

  const fromRaw = fromStr ?? `${todayStr}T00:00:00Z`;
  const toRaw   = toStr   ?? `${todayStr}T23:59:59Z`;

  // Ensure bare dates get Z suffix so Date() treats them as UTC
  const fromNorm = fromRaw.includes('T') ? fromRaw : `${fromRaw}T00:00:00Z`;
  const toNorm   = toRaw.includes('T')   ? toRaw   : `${toRaw}T23:59:59Z`;

  const from = new Date(fromNorm);
  const to   = new Date(toNorm);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    res.status(400).json({
      error: 'Invalid date range. Use ISO-8601 format, e.g. from=2026-06-01&to=2026-06-30',
    });
    return null;
  }

  if (from > to) {
    res.status(400).json({ error: '`from` must be before or equal to `to`' });
    return null;
  }

  return { from, to };
}

// ── GET /api/reports/agent-sessions ─────────────────────────────────────────
/**
 * Returns a session summary row per agent for the date range.
 *
 * Query params:
 *   from      ISO-8601 UTC (default: today 00:00:00Z)
 *   to        ISO-8601 UTC (default: today 23:59:59Z)
 *   agent_id  optional filter to one agent
 *
 * Response:
 * {
 *   date_range: { from, to, timezone },
 *   agents: [
 *     {
 *       agent_id, full_name,
 *       session_count, first_login, last_activity,
 *       total_login_seconds, has_open_session
 *     }, ...
 *   ]
 * }
 */
export async function sessionsSummary(req, res) {
  const range = utcDateRange(req.query.from, req.query.to, res);
  if (!range) return;

  const agentId = req.query.agent_id ?? null;
  const agents  = await svc.getSessionsSummary(range.from, range.to, agentId);

  res.json({
    date_range: {
      from:     range.from.toISOString(),
      to:       range.to.toISOString(),
      timezone: 'UTC',
    },
    agents,
  });
}

// ── GET /api/reports/agent-sessions/:agentId ─────────────────────────────────
/**
 * Returns individual session rows for one agent.
 *
 * Query params: from, to (same as above)
 *
 * Response:
 * {
 *   agent_id, date_range,
 *   sessions: [
 *     { id, agent_id, login_at, logout_at, duration_seconds, logout_reason,
 *       is_open, is_live }, ...
 *   ]
 * }
 */
export async function sessionsList(req, res) {
  const { agentId } = req.params;
  const range = utcDateRange(req.query.from, req.query.to, res);
  if (!range) return;

  const sessions = await svc.getSessionsList(agentId, range.from, range.to);

  res.json({
    agent_id: agentId,
    date_range: {
      from:     range.from.toISOString(),
      to:       range.to.toISOString(),
      timezone: 'UTC',
    },
    sessions,
  });
}

// ── GET /api/reports/agent-activity ─────────────────────────────────────────
/**
 * Returns a combined metrics summary for all agents (or one if agent_id given).
 * One row per agent: sessions, state durations, call metrics, occupancy.
 *
 * Query params: from, to, agent_id (optional)
 *
 * Response:
 * {
 *   date_range,
 *   agents: [
 *     {
 *       agent_id, full_name,
 *       session_count, first_login, last_activity, total_login_seconds, has_open_session,
 *       available_seconds, break_seconds,
 *       calls_offered, calls_answered, calls_missed,
 *       total_ring_seconds, total_talk_seconds, avg_talk_seconds,
 *       occupancy_pct
 *     }, ...
 *   ],
 *   metric_notes: { ... }
 * }
 */
export async function activitySummary(req, res) {
  const range = utcDateRange(req.query.from, req.query.to, res);
  if (!range) return;

  const agentId = req.query.agent_id ?? null;

  // If filtering to one agent use detail path, otherwise summary path
  let agents;
  if (agentId) {
    const detail = await svc.getActivityDetail(agentId, range.from, range.to);
    agents = [{
      agent_id:            detail.agent_id,
      full_name:           detail.full_name,
      session_count:       detail.sessions.count,
      first_login:         detail.sessions.first_login,
      last_activity:       detail.sessions.last_activity,
      total_login_seconds: detail.sessions.total_login_seconds,
      has_open_session:    detail.sessions.has_open_session,
      available_seconds:   detail.state_durations.available_seconds,
      break_seconds:       detail.state_durations.break_seconds,
      calls_offered:       detail.call_metrics.calls_offered,
      calls_answered:      detail.call_metrics.calls_answered,
      calls_missed:        detail.call_metrics.calls_missed,
      total_ring_seconds:  detail.call_metrics.total_ring_seconds,
      total_talk_seconds:  detail.call_metrics.total_talk_seconds,
      avg_talk_seconds:    detail.call_metrics.avg_talk_seconds,
      occupancy_pct:       detail.occupancy.pct,
      open_warnings:       detail.open_warnings,
    }];
  } else {
    agents = await svc.getActivitySummary(range.from, range.to);
  }

  res.json({
    date_range: {
      from:     range.from.toISOString(),
      to:       range.to.toISOString(),
      timezone: 'UTC',
    },
    agents,
    metric_notes: {
      avg_talk_seconds: 'Average talk time for answered calls only. NOT Average Handle Time — hold and wrap-up are not observable in this system.',
      occupancy_pct:    'Formula: (ring_seconds + talk_seconds) / available_seconds × 100. NULL means no Available time recorded in this range.',
      available_seconds:'Measured from agent_state_events. Includes ringing and talking sub-states. Phase 1 data only — empty before Phase 1 deployment.',
      break_seconds:    'Measured from agent_state_events WHERE status = \'On Break\'.',
    },
  });
}

// ── GET /api/reports/agent-activity/:agentId ────────────────────────────────
/**
 * Returns the full detailed report for one agent.
 * Includes individual session list, state event list, break list, occupancy.
 *
 * Query params: from, to
 *
 * Response: see agentReportService.getActivityDetail() JSDoc for full shape.
 */
export async function activityDetail(req, res) {
  const { agentId } = req.params;
  const range = utcDateRange(req.query.from, req.query.to, res);
  if (!range) return;

  const detail = await svc.getActivityDetail(agentId, range.from, range.to);
  res.json(detail);
}

// ── GET /api/reports/agent-state-events/:agentId ────────────────────────────
/**
 * Returns the raw state event segments for one agent (for debugging / drilldown).
 *
 * Query params: from, to
 *
 * Response:
 * {
 *   agent_id, date_range,
 *   events: [
 *     { id, agent_id, session_id, status, started_at, ended_at,
 *       duration_seconds, source, is_open }, ...
 *   ]
 * }
 */
export async function stateEventsList(req, res) {
  const { agentId } = req.params;
  const range = utcDateRange(req.query.from, req.query.to, res);
  if (!range) return;

  const events = await svc.getStateEventsList(agentId, range.from, range.to);

  res.json({
    agent_id: agentId,
    date_range: {
      from:     range.from.toISOString(),
      to:       range.to.toISOString(),
      timezone: 'UTC',
    },
    events,
  });
}
