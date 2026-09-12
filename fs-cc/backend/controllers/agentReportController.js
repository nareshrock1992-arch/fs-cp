/**
 * Agent Report Controller — Phase 2
 *
 * HTTP handlers for the agent session / activity reporting endpoints.
 * All queries and calculations are in agentReportService.js.
 *
 * DATE RANGE CONTRACT
 * ────────────────────
 * All endpoints accept business CALENDAR-date query params:
 *   ?from=2026-06-01  (inclusive lower business day)
 *   ?to=2026-06-30    (inclusive upper business day)
 *
 * Dates are interpreted in the configured BUSINESS_TIMEZONE (not a hardcoded
 * offset, not the container/session tz) via utils/timezone.businessDayRange,
 * producing a HALF-OPEN UTC range [fromUTC, toUTC). If omitted, defaults to the
 * current business day. This matches the boundaries used across the rest of the
 * reporting layer (reportsController, statsController, queryHelpers).
 */

import * as svc from '../services/agentReportService.js';
import { config } from '../config/index.js';
import { businessToday, businessDayRange, toBusinessDateStr } from '../utils/timezone.js';

// ── Date range helper ────────────────────────────────────────────────────────

/**
 * Returns { from: Date, to: Date } as absolute UTC instants for the requested
 * business calendar days, using half-open boundaries in the configured
 * BUSINESS_TIMEZONE (NOT a hardcoded offset, NOT the container/session tz).
 * `from`/`to` are business calendar dates (YYYY-MM-DD; an ISO string's date
 * portion is used). Defaults to the current business day. Responds 400 on
 * invalid input.
 */
function utcDateRange(fromStr, toStr, res) {
  const invalid = () => {
    res.status(400).json({
      error: 'Invalid date range. Use business calendar dates (YYYY-MM-DD), e.g. from=2026-06-01&to=2026-06-30',
    });
    return null;
  };
  try {
    const tz = config.businessTimezone;
    const fromProvided = fromStr != null && String(fromStr).trim() !== '';
    const toProvided   = toStr   != null && String(toStr).trim()   !== '';
    // Omitted → default to today's business day. Provided-but-unparseable → 400.
    const fromDate = fromProvided ? toBusinessDateStr(fromStr) : businessToday(tz);
    const toDate   = toProvided   ? toBusinessDateStr(toStr)   : businessToday(tz);
    if ((fromProvided && !fromDate) || (toProvided && !toDate)) return invalid();

    const from = businessDayRange(fromDate, tz).fromUTC;
    const to   = businessDayRange(toDate, tz).toUTC; // half-open: start of day after toDate
    if (from > to) {
      res.status(400).json({ error: '`from` must be before or equal to `to`' });
      return null;
    }
    return { from, to };
  } catch {
    return invalid();
  }
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
      timezone: config.businessTimezone,
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
      timezone: config.businessTimezone,
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
      timezone: config.businessTimezone,
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
      timezone: config.businessTimezone,
    },
    events,
  });
}
