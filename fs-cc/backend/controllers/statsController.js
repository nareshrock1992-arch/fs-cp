import { query } from '../db/pool.js';
import { config } from '../config/index.js';
import { isConnected } from '../services/eslService.js';
import { businessTodayRange, businessToday } from '../utils/timezone.js';

// GET /api/stats/business-date — the server-authoritative business calendar date
// and configured business timezone, so the frontend seeds date pickers from the
// business day (not the browser/UTC calendar date).
export function getBusinessDate(_req, res) {
  res.json({ business_timezone: config.businessTimezone, business_date: businessToday() });
}

export async function getDashboardStats(req, res) {
  // "Today" = the current business calendar day in BUSINESS_TIMEZONE, as a
  // half-open UTC range [fromUTC, toUTC). Independent of container/PG session tz.
  const { fromUTC, toUTC } = businessTodayRange();
  const day = [fromUTC.toISOString(), toUTC.toISOString()];

  const [agentCounts, callsToday, queueSnapshot, sla, queueDist] = await Promise.all([
    query(`SELECT status, COUNT(*)::INT AS count FROM agents WHERE active = true GROUP BY status`),

    query(
      `SELECT
         COUNT(*)::INT AS total,
         COUNT(*) FILTER (WHERE disposition = 'answered')::INT AS answered,
         COUNT(*) FILTER (WHERE abandoned = true)::INT AS abandoned,
         COALESCE(AVG(wait_seconds) FILTER (WHERE wait_seconds IS NOT NULL AND wait_seconds >= 0), 0)::INT AS avg_wait_seconds,
         COALESCE(AVG(talk_seconds) FILTER (WHERE talk_seconds IS NOT NULL), 0)::INT AS avg_talk_seconds
       FROM calls WHERE start_time >= $1 AND start_time < $2`,
      day
    ),

    query(
      `SELECT queue_name, COUNT(*)::INT AS waiting
       FROM calls
       WHERE end_time IS NULL
         AND disposition = 'waiting'
         AND agent_id IS NULL
         AND start_time > now() - interval '6 hours'
       GROUP BY queue_name`
    ),

    query(
      `SELECT COALESCE(
         100.0
         * COUNT(*) FILTER (WHERE c.wait_seconds <= q.max_wait_time AND c.disposition = 'answered')
         / NULLIF(
             COUNT(*) FILTER (WHERE c.disposition = 'answered') +
             COUNT(*) FILTER (WHERE c.abandoned = true),
             0),
         0
       )::INT AS sla_pct
       FROM calls c
       JOIN queues q ON q.name = c.queue_name
       WHERE c.start_time >= $1 AND c.start_time < $2`,
      day
    ),

    // Per-queue today distribution — same "offered" definition as getQueueStats:
    // COUNT(*) FILTER over the business-day range [$1,$2), all dispositions.
    // LEFT JOIN so queues with zero calls today still appear.
    query(
      `SELECT
         q.name         AS queue_name,
         q.display_name,
         COUNT(*) FILTER (WHERE c.start_time >= $1 AND c.start_time < $2)::INT                           AS offered_today,
         COUNT(*) FILTER (WHERE c.start_time >= $1 AND c.start_time < $2 AND c.disposition = 'answered')::INT AS answered_today,
         -- abandoned_queue = abandoned AND NOT agent-missed. Complement of
         -- abandoned_agent over abandoned, so queue+agent === direct abandoned.
         -- Keyed on missed=true (NOT bare EXISTS agent_history) so a stale
         -- offering row (missed=false) never makes the call vanish from both.
         COUNT(*) FILTER (
           WHERE c.start_time >= $1 AND c.start_time < $2 AND c.abandoned = true
             AND NOT EXISTS (SELECT 1 FROM agent_history ah WHERE ah.call_uuid = c.call_uuid AND ah.missed = true)
         )::INT AS abandoned_queue_today,
         COUNT(*) FILTER (
           WHERE c.start_time >= $1 AND c.start_time < $2 AND c.abandoned = true
             AND EXISTS (SELECT 1 FROM agent_history ah WHERE ah.call_uuid = c.call_uuid AND ah.missed = true)
         )::INT AS abandoned_agent_today
       FROM queues q
       LEFT JOIN calls c ON c.queue_name = q.name
       WHERE q.active = true
       GROUP BY q.name, q.display_name
       ORDER BY offered_today DESC`,
      day
    )
  ]);

  const agentStatusMap = { Available: 0, 'On Break': 0, 'Logged Out': 0 };
  agentCounts.rows.forEach(r => (agentStatusMap[r.status] = r.count));

  res.json({
    eslConnected:     isConnected(),
    agents:           agentStatusMap,
    callsToday:       callsToday.rows[0],
    queueSnapshot:    queueSnapshot.rows,
    slaPct:           sla.rows[0]?.sla_pct ?? 0,
    queueDistribution: queueDist.rows,
  });
}

// GET /api/stats/queues — per-queue live stats for the Queue Stats panel
//
// ⚠️  The old query joined calls → agent_tiers → agents in a single FROM clause.
//     If a queue has N tier rows, every call row was multiplied ×N by the JOIN,
//     causing COUNT(call_uuid) to return N× the real value (e.g. 3 instead of 1).
//
//     Fix: use two independent LATERAL subqueries —
//       cs   → call metrics only, no agent_tiers join
//       ag   → available-agent count only, no calls join
export async function getQueueStats(req, res) {
  // Business-day "today" range (BUSINESS_TIMEZONE), half-open, tz-independent.
  const { fromUTC, toUTC } = businessTodayRange();
  const { rows } = await query(`
    SELECT
      q.name         AS queue_name,
      q.display_name,
      q.strategy,
      q.max_wait_time,

      -- ── Call metrics (LATERAL, no agent_tiers join → no fan-out) ───────────
      cs.waiting,
      cs.active,
      cs.offered_today,
      cs.answered_today,
      cs.abandoned_today,
      cs.abandoned_queue_today,
      cs.abandoned_agent_today,
      cs.avg_wait_today,
      cs.sla_pct_today,
      cs.longest_wait_seconds,

      -- ── Available-agent count (separate LATERAL) ────────────────────────────
      COALESCE(ag.available_agents, 0)::INT AS available_agents

    FROM queues q

    -- ── LATERAL 1: all call statistics for this queue ──────────────────────
    LEFT JOIN LATERAL (
      SELECT
        -- live: waiting in queue (no agent offered yet)
        COUNT(*) FILTER (
          WHERE c.end_time IS NULL
            AND c.agent_id IS NULL
            AND c.disposition = 'waiting'
            AND c.start_time > now() - interval '6 hours'
        )::INT AS waiting,

        -- live: currently bridged to an agent
        COUNT(*) FILTER (
          WHERE c.end_time IS NULL
            AND c.agent_id IS NOT NULL
            AND c.disposition = 'answered'
            AND c.start_time > now() - interval '6 hours'
        )::INT AS active,

        -- today totals
        COUNT(*) FILTER (WHERE (c.start_time >= $1 AND c.start_time < $2))::INT
          AS offered_today,

        COUNT(*) FILTER (
          WHERE (c.start_time >= $1 AND c.start_time < $2) AND c.disposition = 'answered'
        )::INT AS answered_today,

        COUNT(*) FILTER (
          WHERE (c.start_time >= $1 AND c.start_time < $2) AND c.abandoned = true
        )::INT AS abandoned_today,

        -- abandoned in queue = abandoned AND NOT agent-missed (complement of
        -- abandoned_agent over abandoned → queue+agent === direct abandoned).
        -- Keyed on missed=true so a stale offering row (missed=false) is still
        -- counted here rather than disappearing from both buckets.
        COUNT(*) FILTER (
          WHERE (c.start_time >= $1 AND c.start_time < $2)
            AND c.abandoned = true
            AND NOT EXISTS (
              SELECT 1 FROM agent_history ah WHERE ah.call_uuid = c.call_uuid AND ah.missed = true
            )
        )::INT AS abandoned_queue_today,

        -- abandoned after agent was offered but didn't answer
        COUNT(*) FILTER (
          WHERE (c.start_time >= $1 AND c.start_time < $2)
            AND c.abandoned = true
            AND EXISTS (
              SELECT 1 FROM agent_history ah
              WHERE ah.call_uuid = c.call_uuid AND ah.missed = true
            )
        )::INT AS abandoned_agent_today,

        COALESCE(AVG(c.wait_seconds) FILTER (
          WHERE (c.start_time >= $1 AND c.start_time < $2) AND c.disposition = 'answered'
            AND c.wait_seconds >= 0
        ), 0)::INT AS avg_wait_today,

        -- SLA %: answered-within-threshold / (answered + abandoned)
        COALESCE(
          100.0
          * COUNT(*) FILTER (
              WHERE (c.start_time >= $1 AND c.start_time < $2)
                AND c.disposition = 'answered'
                AND c.wait_seconds <= q.max_wait_time
            )
          / NULLIF(
              COUNT(*) FILTER (WHERE (c.start_time >= $1 AND c.start_time < $2) AND c.disposition = 'answered') +
              COUNT(*) FILTER (WHERE (c.start_time >= $1 AND c.start_time < $2) AND c.abandoned = true),
              0),
          0
        )::NUMERIC(5,1) AS sla_pct_today,

        -- longest current wait (seconds)
        COALESCE(MAX(
          EXTRACT(EPOCH FROM (now() - c.queue_enter_time))::INT
        ) FILTER (WHERE c.end_time IS NULL AND c.agent_id IS NULL), 0) AS longest_wait_seconds

      FROM calls c
      WHERE c.queue_name = q.name
    ) cs ON true

    -- ── LATERAL 2: available agent count for this queue ────────────────────
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT a.agent_id)::INT AS available_agents
      FROM  agent_tiers t
      JOIN  agents a ON a.id = t.agent_id
      WHERE t.queue_id   = q.id
        AND a.status     = 'Available'
        AND a.active     = true
    ) ag ON true

    WHERE q.active = true
    ORDER BY q.display_name
  `, [fromUTC.toISOString(), toUTC.toISOString()]);

  res.json(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stats/live-agents — supervisor "Live Agents" operational board.
//
// Returns ONE object per active agent in a SINGLE set-based query (all correlated
// sub-lookups are LATERAL, so there is no N+1 and no GROUP BY fan-out). Nothing
// here changes agent state — it is a read-only derived view over existing tables
// (agents, agent_state_events, agent_state_log, agent_sessions, calls, agent_tiers).
//
// operational_state is derived from the AUTHORITATIVE FreeSWITCH callcenter fields
// agents.status + agents.state (kept fresh by eslService). Mapping:
//   Logged Out / no open session      → Offline
//   On Break                          → On Break
//   Available + Receiving             → Ringing
//   Available + In a queue call       → On Call
//   Available + (Waiting/Idle/other)  → Idle
// Wrap-up and Held are NOT modelled in agents.state, so they are never fabricated.
//
// Timestamps (the client ticks locally from these — no per-second requests):
//   status_since — start of the current Available/On-Break segment (agent_state_events)
//   state_since  — last transition INTO the current fine state (agent_state_log);
//                  used as the TRUE idle anchor so idle time is measured from when
//                  the agent last became Waiting, NOT from when Available began
//                  (status_since would be wrong if calls were handled since).
//   login_at     — open agent_sessions row (login duration)
//   idle_since   — server-chosen idle anchor (state_since || status_since), only
//                  when operational_state = Idle.
//
// Data-consistency precedence rule (async ESL events can briefly disagree):
//   agents.status/state is authoritative for operational_state (the label). The
//   open-call row is surfaced as current_call regardless (never hidden), so a
//   supervisor still sees a lingering call during the brief settling window; the
//   STATE wins for the label. This is intentional and covered by tests.
export async function getLiveAgents(_req, res) {
  const { rows } = await query(`
    SELECT
      a.id,
      a.agent_id,
      a.full_name,
      a.avaya_extension,
      a.status,
      a.state,
      a.break_code,
      bc.name                    AS break_name,
      a.break_started_at,
      ase.started_at             AS status_since,
      sl.changed_at              AS state_since,
      sess.login_at,
      CASE
        WHEN a.status = 'Logged Out' OR sess.login_at IS NULL      THEN 'Offline'
        WHEN a.status = 'On Break'                                 THEN 'On Break'
        WHEN a.status = 'Available' AND a.state = 'Receiving'      THEN 'Ringing'
        WHEN a.status = 'Available' AND a.state = 'In a queue call' THEN 'On Call'
        WHEN a.status = 'Available'                                THEN 'Idle'
        ELSE 'Offline'
      END                        AS operational_state,
      qs.queues,
      CASE WHEN oc.call_uuid IS NULL THEN NULL ELSE json_build_object(
        'call_uuid',         oc.call_uuid,
        'ani',               oc.ani,
        'dnis',              oc.dnis,
        'queue_name',        oc.queue_name,
        'agent_answer_time', oc.agent_answer_time,
        'queue_enter_time',  oc.queue_enter_time,
        'start_time',        oc.start_time
      ) END                      AS current_call

    FROM agents a
    LEFT JOIN break_codes bc ON bc.code = a.break_code

    -- Open status segment (Available/On Break) — same source as GET /api/agents.
    LEFT JOIN LATERAL (
      SELECT started_at FROM agent_state_events
      WHERE agent_id = a.agent_id AND ended_at IS NULL
      LIMIT 1
    ) ase ON true

    -- Last transition INTO the agent's CURRENT fine state (true idle/state anchor).
    LEFT JOIN LATERAL (
      SELECT changed_at FROM agent_state_log
      WHERE agent_id = a.agent_id AND state IS NOT NULL AND state = a.state
      ORDER BY changed_at DESC
      LIMIT 1
    ) sl ON true

    -- Open login session (login duration).
    LEFT JOIN LATERAL (
      SELECT login_at FROM agent_sessions
      WHERE agent_id = a.agent_id AND logout_at IS NULL
      ORDER BY login_at DESC
      LIMIT 1
    ) sess ON true

    -- Current open call for this agent (agent_id is a varchar on calls).
    LEFT JOIN LATERAL (
      SELECT call_uuid, ani, dnis, queue_name, agent_answer_time, queue_enter_time, start_time
      FROM calls
      WHERE agent_id = a.agent_id AND end_time IS NULL
      ORDER BY start_time DESC
      LIMIT 1
    ) oc ON true

    -- Queue membership (aggregated in LATERAL → no GROUP BY needed).
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        json_agg(json_build_object('queue', q.name, 'display_name', q.display_name,
                                   'level', t.level, 'position', t.position)
                 ORDER BY t.level, t.position),
        '[]'
      ) AS queues
      FROM agent_tiers t
      JOIN queues q ON q.id = t.queue_id
      WHERE t.agent_id = a.id
    ) qs ON true

    WHERE a.active = true
    ORDER BY a.full_name ASC
  `);

  const agents = rows.map(r => ({
    ...r,
    idle_since: r.operational_state === 'Idle' ? (r.state_since || r.status_since) : null,
  }));

  // server_time lets the client align its local tick to the server clock (UTC).
  res.json({ eslConnected: isConnected(), server_time: new Date().toISOString(), agents });
}
