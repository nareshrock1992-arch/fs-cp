/**
 * Agent Report Service — Phase 2
 *
 * Provides SQL-level aggregations for agent session, state-duration, and call
 * metrics. All queries run entirely in PostgreSQL; no per-agent JS loops.
 *
 * DATA SOURCES AND WHAT EACH MEASURES
 * ─────────────────────────────────────
 * agent_sessions       → login/logout timestamps, total login duration per period
 * agent_state_events   → Available / On Break durations (Phase 1, measured)
 * agent_history        → ring_seconds, talk_seconds, call counts (existing)
 * agents               → full_name, current status (enrichment only)
 *
 * METRICS NOT IMPLEMENTED (not observable)
 * ─────────────────────────────────────────
 * Hold duration    — mod_callcenter has no hold concept; no FS event emitted
 * Wrap-up duration — wrap_up_time is a configured timer, not a measured event
 * Idle duration    — derivable (Available − ring − talk) but deferred to Phase 3
 *                    after formula validation on real data
 *
 * DATE RANGE CLIPPING
 * ────────────────────
 * All session/event duration calculations clip to the requested date range:
 *   clipped_seconds = LEAST(end, range_end) - GREATEST(start, range_start)
 * This correctly handles:
 *   - Sessions that started before the range (clip start)
 *   - Sessions that end after the range (clip end)
 *   - Open sessions (use now() as end)
 *   - Midnight-crossing sessions (both clips apply)
 *
 * OCCUPANCY FORMULA
 * ──────────────────
 * occupancy_pct = (ring_seconds + talk_seconds) / available_seconds × 100
 *
 * Justification:
 *   - Available status is maintained during ringing AND talking (mod_callcenter
 *     never changes agent status to a call-specific value; only state changes)
 *   - Therefore ring and talk time are strict subsets of available time
 *   - The formula is non-overlapping and unambiguous
 *   - Zero denominator → NULL (agent was never Available in range)
 *   - Ring seconds from agent_history, talk seconds from agent_history
 *   - Available seconds from agent_state_events
 *
 * NOTE ON AHT
 * ───────────
 * avg_talk_seconds is reported, NOT "AHT". True AHT requires talk + hold +
 * wrap-up. Hold and wrap-up are not observable in this system. The field is
 * explicitly named avg_talk_seconds to avoid implying a full AHT calculation.
 *
 * TIMEZONE
 * ─────────
 * All timestamps stored as TIMESTAMPTZ (UTC). Date range boundaries passed from
 * the controller as JavaScript Date objects (always UTC-aware).
 * Both controllers now use IST midnight boundaries. dateRange() in reportsController
 * produces IST midnight via local-time parsing on the IST server (correct).
 * utcDateRange() in agentReportController uses explicit +05:30 offset (also correct).
 */

import { query } from '../db/pool.js';

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Clip expression: duration of an interval [col_start, col_end] that falls
 * within [$1, $2]. Returns INT seconds. Negative values floored at 0.
 *
 * col_end_expr must be a SQL expression — pass COALESCE(ended_at, now()) for
 * open events, COALESCE(logout_at, now()) for open sessions.
 */
function clipSeconds(colStart, colEndExpr) {
  return `GREATEST(
    EXTRACT(EPOCH FROM (
      LEAST(${colEndExpr}, $2) - GREATEST(${colStart}, $1)
    ))::INT,
    0
  )`;
}

// ── 1. Sessions summary (all agents or one) ──────────────────────────────────

/**
 * Returns one row per agent: session count, first/last timestamps, total
 * logged-in seconds (clipped to date range), open-session flag.
 *
 * @param {Date}         from
 * @param {Date}         to
 * @param {string|null}  agentId  — null = all agents
 */
export async function getSessionsSummary(from, to, agentId = null) {
  const clip = clipSeconds('s.login_at', 'COALESCE(s.logout_at, now())');

  const conditions = [
    's.login_at < $2',
    '(s.logout_at IS NULL OR s.logout_at > $1)',
  ];
  const params = [from, to];

  if (agentId) {
    conditions.push(`s.agent_id = $3`);
    params.push(agentId);
  }

  const where = conditions.join(' AND ');

  const { rows } = await query(
    `SELECT
       s.agent_id,
       a.full_name,
       COUNT(DISTINCT s.id)::INT                    AS session_count,
       MIN(s.login_at)                              AS first_login,
       MAX(COALESCE(s.logout_at, now()))            AS last_activity,
       SUM(${clip})::INT                            AS total_login_seconds,
       BOOL_OR(s.logout_at IS NULL)                 AS has_open_session
     FROM agent_sessions s
     LEFT JOIN agents a ON a.agent_id = s.agent_id
     WHERE ${where}
     GROUP BY s.agent_id, a.full_name
     ORDER BY first_login DESC NULLS LAST`,
    params
  );
  return rows;
}

// ── 2. Individual sessions for one agent ────────────────────────────────────

/**
 * Returns one row per session for the given agent that overlaps the date range.
 * Open sessions have logout_at = null and is_open = true.
 * duration_seconds for open sessions is computed live (now() − login_at).
 *
 * @param {string}  agentId
 * @param {Date}    from
 * @param {Date}    to
 */
export async function getSessionsList(agentId, from, to) {
  const { rows } = await query(
    `SELECT
       s.id,
       s.agent_id,
       s.login_at,
       s.logout_at,
       s.logout_reason,
       CASE
         WHEN s.logout_at IS NULL
           THEN EXTRACT(EPOCH FROM (now() - s.login_at))::INT
         ELSE s.duration_seconds
       END                                          AS duration_seconds,
       (s.logout_at IS NULL)                        AS is_open,
       (s.logout_at IS NULL)                        AS is_live
     FROM agent_sessions s
     WHERE s.agent_id  = $1
       AND s.login_at  < $3
       AND (s.logout_at IS NULL OR s.logout_at > $2)
     ORDER BY s.login_at DESC`,
    [agentId, from, to]
  );
  return rows;
}

// ── 3. State-event segments for one agent ────────────────────────────────────

/**
 * Returns one row per state event segment for the given agent, ordered by
 * started_at DESC.
 * duration_seconds for open events is computed live.
 *
 * @param {string}  agentId
 * @param {Date}    from
 * @param {Date}    to
 */
export async function getStateEventsList(agentId, from, to) {
  const { rows } = await query(
    `SELECT
       e.id,
       e.agent_id,
       e.session_id,
       e.status,
       e.started_at,
       e.ended_at,
       CASE
         WHEN e.ended_at IS NULL
           THEN EXTRACT(EPOCH FROM (now() - e.started_at))::INT
         ELSE e.duration_seconds
       END                                          AS duration_seconds,
       e.source,
       (e.ended_at IS NULL)                         AS is_open
     FROM agent_state_events e
     WHERE e.agent_id   = $1
       AND e.started_at < $3
       AND (e.ended_at IS NULL OR e.ended_at > $2)
     ORDER BY e.started_at DESC`,
    [agentId, from, to]
  );
  return rows;
}

// ── 4. State-duration aggregates (all agents or one) ────────────────────────

/**
 * Aggregates Available/Break durations per agent, clipped to date range.
 * Returns one row per (agent_id, status).
 *
 * @param {Date}         from
 * @param {Date}         to
 * @param {string|null}  agentId  — null = all agents
 */
export async function getStateDurations(from, to, agentId = null) {
  const clip = clipSeconds('e.started_at', 'COALESCE(e.ended_at, now())');

  const conditions = [
    'e.started_at < $2',
    '(e.ended_at IS NULL OR e.ended_at > $1)',
  ];
  const params = [from, to];

  if (agentId) {
    conditions.push(`e.agent_id = $3`);
    params.push(agentId);
  }

  const where = conditions.join(' AND ');

  const { rows } = await query(
    `SELECT
       e.agent_id,
       a.full_name,
       e.status,
       COUNT(*)::INT                                AS segment_count,
       SUM(${clip})::INT                            AS total_seconds,
       MAX(${clip})::INT                            AS max_segment_seconds,
       ROUND(AVG(${clip})::NUMERIC, 0)::INT         AS avg_segment_seconds
     FROM agent_state_events e
     LEFT JOIN agents a ON a.agent_id = e.agent_id
     WHERE ${where}
     GROUP BY e.agent_id, a.full_name, e.status
     ORDER BY e.agent_id, e.status`,
    params
  );
  return rows;
}

// ── 5. Call metrics (all agents or one) ────────────────────────────────────

/**
 * Call performance aggregated from agent_history.
 * Filtered by ring_start (when the agent was offered the call).
 * Note: calls that started before `from` but had ring_start within range are
 * included; calls where ring_start falls outside range are excluded even if
 * talk occurred within range. This is a known approximation (acceptable
 * because individual call legs are typically seconds to a few minutes).
 *
 * @param {Date}         from
 * @param {Date}         to
 * @param {string|null}  agentId  — null = all agents
 */
export async function getCallMetrics(from, to, agentId = null) {
  const conditions = ['ah.ring_start >= $1', 'ah.ring_start < $2'];
  const params = [from, to];

  if (agentId) {
    conditions.push(`ah.agent_id = $3`);
    params.push(agentId);
  }

  const where = conditions.join(' AND ');

  const { rows } = await query(
    `SELECT
       ah.agent_id,
       a.full_name,

       COUNT(*)::INT                                                             AS calls_offered,
       COUNT(*) FILTER (WHERE ah.missed = false AND ah.talk_start IS NOT NULL)::INT
                                                                                AS calls_answered,
       COUNT(*) FILTER (WHERE ah.missed = true)::INT                            AS calls_missed,

       -- ring_seconds: sum for ALL offered calls (including missed)
       COALESCE(SUM(ah.ring_seconds), 0)::INT                                   AS total_ring_seconds,

       -- talk_seconds: answered calls only
       COALESCE(SUM(ah.talk_seconds) FILTER (WHERE ah.missed = false), 0)::INT  AS total_talk_seconds,

       -- avg_talk_seconds: average talk time for answered calls only.
       -- NOTE: this is NOT AHT. AHT would require hold + wrap-up, which are
       -- not observable in this system. This field is intentionally named
       -- avg_talk_seconds to avoid implying a complete AHT calculation.
       COALESCE(
         AVG(ah.talk_seconds) FILTER (WHERE ah.missed = false AND ah.talk_start IS NOT NULL),
         0
       )::INT                                                                    AS avg_talk_seconds,

       COALESCE(MAX(ah.talk_seconds) FILTER (WHERE ah.missed = false), 0)::INT  AS max_talk_seconds,
       COALESCE(MIN(ah.talk_seconds) FILTER (WHERE ah.missed = false AND ah.talk_seconds > 0), 0)::INT
                                                                                AS min_talk_seconds

     FROM agent_history ah
     LEFT JOIN agents a ON a.agent_id = ah.agent_id
     WHERE ${where}
     GROUP BY ah.agent_id, a.full_name
     ORDER BY calls_answered DESC, calls_offered DESC`,
    params
  );
  return rows;
}

// ── 6. Break list for one agent ─────────────────────────────────────────────

/**
 * Returns individual break segments (On Break state events) for one agent.
 * Duration for open breaks is computed live.
 *
 * @param {string}  agentId
 * @param {Date}    from
 * @param {Date}    to
 */
export async function getBreakList(agentId, from, to) {
  const { rows } = await query(
    `SELECT
       e.id,
       e.started_at                                 AS break_start,
       e.ended_at                                   AS break_end,
       CASE
         WHEN e.ended_at IS NULL
           THEN EXTRACT(EPOCH FROM (now() - e.started_at))::INT
         ELSE e.duration_seconds
       END                                          AS duration_seconds,
       e.source,
       (e.ended_at IS NULL)                         AS is_open
     FROM agent_state_events e
     WHERE e.agent_id   = $1
       AND e.status     = 'On Break'
       AND e.started_at < $3
       AND (e.ended_at IS NULL OR e.ended_at > $2)
     ORDER BY e.started_at DESC`,
    [agentId, from, to]
  );
  return rows;
}

// ── 7. Full activity detail for one agent ────────────────────────────────────

/**
 * Combines all metrics into a single structured object for one agent.
 * Runs four queries in parallel; computes occupancy in the service layer.
 *
 * Returned shape:
 * {
 *   agent_id, full_name,
 *   date_range: { from, to, timezone: 'UTC' },
 *   sessions:   { count, first_login, last_logout, total_login_seconds, has_open_session },
 *   state_durations: {
 *     available_seconds, available_segment_count, available_avg_seconds, available_max_seconds,
 *     break_seconds, break_count, break_avg_seconds, break_max_seconds,
 *     data_start_note
 *   },
 *   call_metrics:    { calls_offered, calls_answered, calls_missed, total_ring_seconds,
 *                      total_talk_seconds, avg_talk_seconds, max_talk_seconds, min_talk_seconds,
 *                      aht_note },
 *   occupancy:       { pct, available_seconds, engaged_seconds, formula, note },
 *   breaks:          { list: [...], total_seconds, count, avg_seconds, longest_seconds },
 *   open_warnings:   [...],
 * }
 *
 * @param {string}  agentId
 * @param {Date}    from
 * @param {Date}    to
 * @param {object}  agentRow   optional { agent_id, full_name } from caller
 */
export async function getActivityDetail(agentId, from, to) {
  // Run all four queries in parallel
  const [sessSum, stateDur, callMet, breakList] = await Promise.all([
    getSessionsSummary(from, to, agentId),
    getStateDurations(from, to, agentId),
    getCallMetrics(from, to, agentId),
    getBreakList(agentId, from, to),
  ]);

  // Extract per-status rows from stateDur
  const availRow = stateDur.find(r => r.status === 'Available') || null;
  const breakRow = stateDur.find(r => r.status === 'On Break')  || null;
  const sessRow  = sessSum[0] || null;
  const callRow  = callMet[0] || null;

  // Get agent full_name from any source (may be null if agent_id unknown)
  const fullName = availRow?.full_name
    ?? breakRow?.full_name
    ?? sessRow?.full_name
    ?? callRow?.full_name
    ?? null;

  const availSeconds   = availRow?.total_seconds ?? 0;
  const breakSeconds   = breakRow?.total_seconds ?? 0;
  const ringSeconds    = callRow?.total_ring_seconds  ?? 0;
  const talkSeconds    = callRow?.total_talk_seconds  ?? 0;
  const engagedSeconds = ringSeconds + talkSeconds;

  // Occupancy: engaged / available (NULL when available = 0)
  const occupancyPct = availSeconds > 0
    ? Math.round((engagedSeconds / availSeconds) * 1000) / 10  // one decimal, e.g. 72.4
    : null;

  const openWarnings = [];
  if (sessRow?.has_open_session) {
    openWarnings.push('Agent has an active open session — login duration is LIVE and will increase.');
  }
  const openBreaks = breakList.filter(b => b.is_open);
  if (openBreaks.length > 0) {
    openWarnings.push('Agent is currently on break — break duration is LIVE and will increase.');
  }

  // Break aggregates (clipped durations already computed per row)
  const breakDurations = breakList.map(b => b.duration_seconds).filter(d => d > 0);
  const breakTotal     = breakDurations.reduce((a, b) => a + b, 0);
  const breakAvg       = breakDurations.length > 0
    ? Math.round(breakTotal / breakDurations.length) : 0;
  const breakLongest   = breakDurations.length > 0 ? Math.max(...breakDurations) : 0;

  return {
    agent_id:  agentId,
    full_name: fullName,

    date_range: {
      from:     from.toISOString(),
      to:       to.toISOString(),
      timezone: 'UTC',
    },

    sessions: {
      count:               sessRow?.session_count      ?? 0,
      first_login:         sessRow?.first_login        ?? null,
      last_activity:       sessRow?.last_activity      ?? null,
      total_login_seconds: sessRow?.total_login_seconds ?? 0,
      has_open_session:    sessRow?.has_open_session   ?? false,
      data_note:           'Login duration is clipped to the requested date range.',
    },

    state_durations: {
      // MEASURED: directly from agent_state_events (Phase 1 data)
      available_seconds:         availSeconds,
      available_segment_count:   availRow?.segment_count      ?? 0,
      available_avg_seconds:     availRow?.avg_segment_seconds ?? 0,
      available_max_seconds:     availRow?.max_segment_seconds ?? 0,
      break_seconds:             breakSeconds,
      break_count:               breakRow?.segment_count      ?? 0,
      break_avg_seconds:         breakRow?.avg_segment_seconds ?? 0,
      break_max_seconds:         breakRow?.max_segment_seconds ?? 0,
      measurement:               'MEASURED',
      data_note: [
        'Available duration includes ringing and talking sub-states.',
        'Hold and wrap-up are NOT observable — not included.',
        'Idle (Available − ring − talk) is derivable but deferred pending validation.',
        'Data available from Phase 1 deployment date only.',
      ],
    },

    call_metrics: {
      // MEASURED: from agent_history (ring_start, ring_seconds, talk_seconds)
      calls_offered:        callRow?.calls_offered     ?? 0,
      calls_answered:       callRow?.calls_answered    ?? 0,
      calls_missed:         callRow?.calls_missed      ?? 0,
      total_ring_seconds:   ringSeconds,
      total_talk_seconds:   talkSeconds,
      avg_talk_seconds:     callRow?.avg_talk_seconds  ?? 0,
      max_talk_seconds:     callRow?.max_talk_seconds  ?? 0,
      min_talk_seconds:     callRow?.min_talk_seconds  ?? 0,
      measurement:          'MEASURED',
      aht_note: [
        'avg_talk_seconds is average talk time only — this is NOT Average Handle Time.',
        'True AHT requires talk + hold + wrap-up.',
        'Hold and wrap-up are not observable in this system.',
      ],
    },

    occupancy: {
      // DERIVED: formula = (ring + talk) / available
      pct:               occupancyPct,   // null when available_seconds = 0
      available_seconds: availSeconds,
      engaged_seconds:   engagedSeconds,
      ring_seconds:      ringSeconds,
      talk_seconds:      talkSeconds,
      formula:           '(ring_seconds + talk_seconds) / available_seconds × 100',
      formula_basis: [
        'ring_seconds and talk_seconds are strict subsets of available_seconds',
        '(agent status stays Available during ringing and talking)',
        'Formula is non-overlapping and unambiguous within those bounds',
      ],
      measurement: 'DERIVED',
      null_reason: occupancyPct === null
        ? 'available_seconds is 0 — agent had no Available time in this range'
        : null,
    },

    breaks: {
      // Source: agent_state_events WHERE status='On Break'
      list:            breakList,
      total_seconds:   breakTotal,
      count:           breakList.length,
      avg_seconds:     breakAvg,
      longest_seconds: breakLongest,
      measurement:     'MEASURED',
      type_note: [
        'Break type (voluntary vs. automatic after missed call) is not distinguished in Phase 1.',
        'All On Break segments are recorded identically.',
        'The source field (fs_event, agent_self, manual) indicates who triggered the break.',
      ],
    },

    open_warnings: openWarnings,
  };
}

// ── 8. Activity summary for all agents ────────────────────────────────────

/**
 * Returns one row per agent with all key metrics combined.
 * Runs three parallel queries; joins results by agent_id in JS.
 * Suitable for a summary table showing all agents side-by-side.
 *
 * @param {Date}  from
 * @param {Date}  to
 */
export async function getActivitySummary(from, to) {
  const [sessSummary, stateDurations, callMetrics] = await Promise.all([
    getSessionsSummary(from, to, null),
    getStateDurations(from, to, null),
    getCallMetrics(from, to, null),
  ]);

  // Build lookup maps keyed by agent_id
  const sessMap  = new Map(sessSummary.map(r => [r.agent_id, r]));
  const callMap  = new Map(callMetrics.map(r => [r.agent_id, r]));

  // Pivot stateDurations: { agent_id → { Available: row, 'On Break': row } }
  const stateMap = new Map();
  for (const r of stateDurations) {
    if (!stateMap.has(r.agent_id)) stateMap.set(r.agent_id, {});
    stateMap.get(r.agent_id)[r.status] = r;
  }

  // Union of all agent_ids appearing in any source
  const allAgentIds = new Set([
    ...sessMap.keys(),
    ...stateMap.keys(),
    ...callMap.keys(),
  ]);

  // Collect all full_names (first non-null wins)
  const nameMap = new Map();
  for (const r of [...sessSummary, ...stateDurations, ...callMetrics]) {
    if (r.full_name && !nameMap.has(r.agent_id)) nameMap.set(r.agent_id, r.full_name);
  }

  const result = [];

  for (const agentId of allAgentIds) {
    const sess   = sessMap.get(agentId)  || null;
    const states = stateMap.get(agentId) || {};
    const calls  = callMap.get(agentId)  || null;

    const availSeconds   = states['Available']?.total_seconds ?? 0;
    const breakSeconds   = states['On Break']?.total_seconds  ?? 0;
    const ringSeconds    = calls?.total_ring_seconds  ?? 0;
    const talkSeconds    = calls?.total_talk_seconds  ?? 0;
    const engagedSeconds = ringSeconds + talkSeconds;

    const occupancyPct = availSeconds > 0
      ? Math.round((engagedSeconds / availSeconds) * 1000) / 10
      : null;

    result.push({
      agent_id:            agentId,
      full_name:           nameMap.get(agentId) ?? null,
      session_count:       sess?.session_count       ?? 0,
      first_login:         sess?.first_login         ?? null,
      last_activity:       sess?.last_activity       ?? null,
      total_login_seconds: sess?.total_login_seconds ?? 0,
      has_open_session:    sess?.has_open_session     ?? false,

      // MEASURED state durations
      available_seconds:   availSeconds,
      break_seconds:       breakSeconds,

      // MEASURED call metrics
      calls_offered:    calls?.calls_offered    ?? 0,
      calls_answered:   calls?.calls_answered   ?? 0,
      calls_missed:     calls?.calls_missed     ?? 0,
      total_ring_seconds: ringSeconds,
      total_talk_seconds: talkSeconds,
      avg_talk_seconds: calls?.avg_talk_seconds  ?? 0,

      // DERIVED
      occupancy_pct:    occupancyPct,
    });
  }

  // Sort by total login time descending
  result.sort((a, b) => b.total_login_seconds - a.total_login_seconds);
  return result;
}
