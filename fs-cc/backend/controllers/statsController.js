import { query } from '../db/pool.js';
import { isConnected } from '../services/eslService.js';

export async function getDashboardStats(req, res) {
  const [agentCounts, callsToday, queueSnapshot, sla, queueDist] = await Promise.all([
    query(`SELECT status, COUNT(*)::INT AS count FROM agents WHERE active = true GROUP BY status`),

    query(
      `SELECT
         COUNT(*)::INT AS total,
         COUNT(*) FILTER (WHERE disposition = 'answered')::INT AS answered,
         COUNT(*) FILTER (WHERE abandoned = true)::INT AS abandoned,
         COALESCE(AVG(wait_seconds) FILTER (WHERE wait_seconds IS NOT NULL), 0)::INT AS avg_wait_seconds,
         COALESCE(AVG(talk_seconds) FILTER (WHERE talk_seconds IS NOT NULL), 0)::INT AS avg_talk_seconds
       FROM calls WHERE start_time >= CURRENT_DATE`
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
       WHERE c.start_time >= CURRENT_DATE`
    ),

    // Per-queue today distribution — same "offered" definition as getQueueStats:
    // COUNT(*) FILTER (WHERE start_time >= CURRENT_DATE), all dispositions.
    // LEFT JOIN so queues with zero calls today still appear.
    query(
      `SELECT
         q.name         AS queue_name,
         q.display_name,
         COUNT(*) FILTER (WHERE c.start_time >= CURRENT_DATE)::INT                           AS offered_today,
         COUNT(*) FILTER (WHERE c.start_time >= CURRENT_DATE AND c.disposition = 'answered')::INT AS answered_today,
         COUNT(*) FILTER (
           WHERE c.start_time >= CURRENT_DATE AND c.abandoned = true
             AND NOT EXISTS (SELECT 1 FROM agent_history ah WHERE ah.call_uuid = c.call_uuid)
         )::INT AS abandoned_queue_today,
         COUNT(*) FILTER (
           WHERE c.start_time >= CURRENT_DATE AND c.abandoned = true
             AND EXISTS (SELECT 1 FROM agent_history ah WHERE ah.call_uuid = c.call_uuid AND ah.missed = true)
         )::INT AS abandoned_agent_today
       FROM queues q
       LEFT JOIN calls c ON c.queue_name = q.name
       WHERE q.active = true
       GROUP BY q.name, q.display_name
       ORDER BY offered_today DESC`
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
        COUNT(*) FILTER (WHERE c.start_time >= CURRENT_DATE)::INT
          AS offered_today,

        COUNT(*) FILTER (
          WHERE c.start_time >= CURRENT_DATE AND c.disposition = 'answered'
        )::INT AS answered_today,

        COUNT(*) FILTER (
          WHERE c.start_time >= CURRENT_DATE AND c.abandoned = true
        )::INT AS abandoned_today,

        -- abandoned before any agent was offered
        COUNT(*) FILTER (
          WHERE c.start_time >= CURRENT_DATE
            AND c.abandoned = true
            AND NOT EXISTS (
              SELECT 1 FROM agent_history ah WHERE ah.call_uuid = c.call_uuid
            )
        )::INT AS abandoned_queue_today,

        -- abandoned after agent was offered but didn't answer
        COUNT(*) FILTER (
          WHERE c.start_time >= CURRENT_DATE
            AND c.abandoned = true
            AND EXISTS (
              SELECT 1 FROM agent_history ah
              WHERE ah.call_uuid = c.call_uuid AND ah.missed = true
            )
        )::INT AS abandoned_agent_today,

        COALESCE(AVG(c.wait_seconds) FILTER (
          WHERE c.start_time >= CURRENT_DATE AND c.disposition = 'answered'
        ), 0)::INT AS avg_wait_today,

        -- SLA %: answered-within-threshold / (answered + abandoned)
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
  `);

  res.json(rows);
}
