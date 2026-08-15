import { query } from '../db/pool.js';

function dateRange(req) {
  // "2026-06-26" parses to midnight UTC — add 23:59:59 so the full day is included.
  const from = req.query.from
    ? new Date(req.query.from + 'T00:00:00')
    : new Date(Date.now() - 7 * 86400000);
  const to = req.query.to
    ? new Date(req.query.to + 'T23:59:59.999')
    : new Date();
  return { from, to };
}

export async function queuePerformance(req, res) {
  const { from, to } = dateRange(req);
  const { rows } = await query(
    `SELECT
       c.queue_name,
       COUNT(*)::INT                                                              AS offered,
       COUNT(*) FILTER (WHERE c.disposition = 'answered')::INT                   AS answered,
       -- abandoned_queue: caller hung up before ANY agent was offered
       COUNT(*) FILTER (
         WHERE c.abandoned = true
           AND NOT EXISTS (
             SELECT 1 FROM agent_history ah
             WHERE ah.call_uuid = c.call_uuid
           )
       )::INT                                                                     AS abandoned_queue,
       -- abandoned_agent: at least one agent was offered but did not answer
       COUNT(*) FILTER (
         WHERE c.abandoned = true
           AND EXISTS (
             SELECT 1 FROM agent_history ah
             WHERE ah.call_uuid = c.call_uuid AND ah.missed = true
           )
       )::INT                                                                     AS abandoned_agent,
       -- total abandoned (for abandon_rate_pct)
       COUNT(*) FILTER (WHERE c.abandoned = true)::INT                           AS abandoned,
       COALESCE(AVG(c.wait_seconds) FILTER (WHERE c.disposition = 'answered'), 0)::INT
                                                                                  AS asa_seconds,
       COALESCE(AVG(c.talk_seconds) FILTER (WHERE c.disposition = 'answered'), 0)::INT
                                                                                  AS aht_seconds,
       COALESCE(
         100.0 * COUNT(*) FILTER (WHERE c.abandoned = true) / NULLIF(COUNT(*), 0),
         0
       )::NUMERIC(5,1)                                                            AS abandon_rate_pct,
       -- SLA: answered-within-threshold / (answered + abandoned)
       COALESCE(
         100.0
         * COUNT(*) FILTER (
             WHERE c.disposition = 'answered'
               AND c.wait_seconds <= COALESCE(
                 (SELECT max_wait_time FROM queues WHERE name = c.queue_name LIMIT 1), 300)
           )
         / NULLIF(
             COUNT(*) FILTER (WHERE c.disposition = 'answered') +
             COUNT(*) FILTER (WHERE c.abandoned = true),
             0),
         0
       )::NUMERIC(5,1)                                                            AS sla_pct
     FROM calls c
     WHERE c.start_time BETWEEN $1 AND $2 AND c.queue_name IS NOT NULL
     GROUP BY c.queue_name
     ORDER BY offered DESC`,
    [from, to]
  );
  res.json(rows);
}

export async function agentPerformance(req, res) {
  const { from, to } = dateRange(req);

  // Use agent_history as the source of truth:
  //   - calls_offered  = every row (agent was offered the call)
  //   - calls_answered = rows where missed=false AND talk_start IS NOT NULL
  //   - calls_missed   = rows where missed=true
  //   - AHT            = avg(talk_seconds) for answered rows / 60 → minutes
  //   - total_talk     = sum(talk_seconds) for answered rows / 60 → minutes
  //
  // ring_start is used for date filtering (when the offer happened).
  const { rows } = await query(
    `SELECT
       ah.agent_id,
       a.full_name,
       COUNT(*)::INT                                                         AS calls_offered,
       COUNT(*) FILTER (WHERE ah.missed = false AND ah.talk_start IS NOT NULL)::INT
                                                                             AS calls_answered,
       COUNT(*) FILTER (WHERE ah.missed = true)::INT                        AS calls_missed,
       ROUND(
         COALESCE(
           SUM(ah.talk_seconds) FILTER (WHERE ah.missed = false)::NUMERIC
           / NULLIF(COUNT(*) FILTER (WHERE ah.missed = false AND ah.talk_start IS NOT NULL), 0)
           / 60.0,
           0
         ), 2
       )                                                                     AS aht_min,
       ROUND(
         COALESCE(SUM(ah.talk_seconds) FILTER (WHERE ah.missed = false)::NUMERIC / 60.0, 0),
         2
       )                                                                     AS total_talk_min
     FROM agent_history ah
     LEFT JOIN agents a ON a.agent_id = ah.agent_id
     WHERE ah.ring_start BETWEEN $1 AND $2
     GROUP BY ah.agent_id, a.full_name
     ORDER BY calls_answered DESC, calls_offered DESC`,
    [from, to]
  );
  res.json(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// IVR path distribution — returns three semantically distinct arrays:
//
//   dtmf   — DTMF digits pressed at any point during the call
//             Source: calls.ivr_path, elements where digit IS NOT NULL
//             Counted as unique calls per digit (deduplicated by call_uuid + digit)
//
//   queues — Calls that actually entered a FreeSWITCH queue
//             Source: calls.queue_name IS NOT NULL  ← authoritative queue membership
//             NOT derived from ivr_path app=callcenter (which only records
//             the callcenter application attempt, not confirmed queue membership)
//
//   other  — Other FreeSWITCH application/system events from ivr_path
//             (playback, gather_digits, menu, ivr, speak, variable_ivr_step, etc.)
//             Counted as unique calls per step value
//
// All three share the same date filter and report population.
// ─────────────────────────────────────────────────────────────────────────────
export async function ivrPathDistribution(req, res) {
  const { from, to } = dateRange(req);

  // ── DTMF: unique calls per digit pressed ─────────────────────────────────
  // Deduplicate at (call_uuid, digit) level: a call where "1" is pressed
  // three times counts as one call for digit "1", not three events.
  const dtmfRows = await query(
    `SELECT
       digit_val                        AS digit,
       COUNT(DISTINCT call_uuid)::INT   AS calls
     FROM (
       SELECT
         c.call_uuid,
         step_obj->>'digit' AS digit_val
       FROM calls c,
            jsonb_array_elements(c.ivr_path) AS step_obj
       WHERE c.start_time BETWEEN $1 AND $2
         AND jsonb_array_length(c.ivr_path) > 0
         AND (step_obj->>'digit') IS NOT NULL
         AND (step_obj->>'digit') <> ''
     ) sub
     GROUP BY digit_val
     ORDER BY calls DESC`,
    [from, to]
  );

  // ── Queue destinations: calls that actually became queue members ──────────
  // calls.queue_name is set only by the member-queue-start callcenter::info
  // event — confirmed queue membership, not merely a callcenter app attempt.
  // split_part strips the @context suffix (e.g. "Support@default" → "Support")
  // to match how queue names are displayed in Queue Performance and CDR.
  const queueRows = await query(
    `SELECT
       split_part(queue_name, '@', 1) AS queue,
       COUNT(*)::INT                  AS calls
     FROM calls
     WHERE start_time BETWEEN $1 AND $2
       AND queue_name IS NOT NULL
     GROUP BY split_part(queue_name, '@', 1)
     ORDER BY calls DESC`,
    [from, to]
  );

  // ── Other system events: non-DTMF, non-callcenter ivr_path steps ─────────
  // Includes: playback, gather_digits, menu, ivr, speak, phrase,
  // variable_ivr_step values, and any other application events.
  // Unknown/malformed elements (no digit AND no app or unknown app) also
  // fall here — nothing is silently discarded.
  const otherRows = await query(
    `SELECT
       step_val                         AS step,
       COUNT(DISTINCT call_uuid)::INT   AS calls
     FROM (
       SELECT
         c.call_uuid,
         COALESCE(step_obj->>'step', '(unknown)') AS step_val
       FROM calls c,
            jsonb_array_elements(c.ivr_path) AS step_obj
       WHERE c.start_time BETWEEN $1 AND $2
         AND jsonb_array_length(c.ivr_path) > 0
         AND (step_obj->>'digit') IS NULL
         AND COALESCE(step_obj->>'app', '') <> 'callcenter'
     ) sub
     GROUP BY step_val
     ORDER BY calls DESC`,
    [from, to]
  );

  // ── Compute share % within each section independently ────────────────────
  function withShare(rows, key) {
    const total = rows.reduce((s, r) => s + Number(r.calls), 0);
    return rows.map(r => ({
      ...r,
      calls: Number(r.calls),
      share: total > 0 ? Math.round((Number(r.calls) / total) * 100) : 0,
    }));
  }

  res.json({
    dtmf:   withShare(dtmfRows.rows,  'digit'),
    queues: withShare(queueRows.rows, 'queue'),
    other:  withShare(otherRows.rows, 'step'),
  });
}

export async function callVolumeByDay(req, res) {
  const { from, to } = dateRange(req);
  const { rows } = await query(
    `SELECT
       date_trunc('day', start_time)::DATE AS day,
       COUNT(*)::INT AS offered,
       COUNT(*) FILTER (WHERE disposition = 'answered')::INT AS answered,
       COUNT(*) FILTER (WHERE abandoned = true)::INT AS abandoned
     FROM calls
     WHERE start_time BETWEEN $1 AND $2
     GROUP BY day ORDER BY day ASC`,
    [from, to]
  );
  res.json(rows);
}

// GET /api/reports/export?type=queue-performance|agent-performance|call-volume&format=csv|json
export async function exportReport(req, res) {
  const { type = 'queue-performance', format = 'csv' } = req.query;
  const { from, to } = dateRange(req);

  let rows = [], columns = [];

  if (type === 'queue-performance') {
    const r = await query(
      `SELECT c.queue_name,
         COUNT(*)::INT AS offered,
         COUNT(*) FILTER (WHERE c.disposition='answered')::INT AS answered,
         COUNT(*) FILTER (WHERE c.abandoned=true AND NOT EXISTS(
           SELECT 1 FROM agent_history ah WHERE ah.call_uuid=c.call_uuid))::INT AS abandoned_queue,
         COUNT(*) FILTER (WHERE c.abandoned=true AND EXISTS(
           SELECT 1 FROM agent_history ah WHERE ah.call_uuid=c.call_uuid AND ah.missed=true))::INT AS abandoned_agent,
         COALESCE(AVG(c.wait_seconds) FILTER (WHERE c.disposition='answered'),0)::INT AS asa_seconds,
         COALESCE(AVG(c.talk_seconds) FILTER (WHERE c.disposition='answered'),0)::INT AS aht_seconds,
         COALESCE(100.0*COUNT(*) FILTER (WHERE c.abandoned=true)/NULLIF(COUNT(*),0),0)::NUMERIC(5,1) AS abandon_rate_pct,
         COALESCE(100.0
           * COUNT(*) FILTER (WHERE c.disposition='answered' AND c.wait_seconds <= COALESCE(
               (SELECT max_wait_time FROM queues WHERE name=c.queue_name LIMIT 1),300))
           / NULLIF(COUNT(*) FILTER (WHERE c.disposition='answered') +
                    COUNT(*) FILTER (WHERE c.abandoned=true), 0), 0)::NUMERIC(5,1) AS sla_pct
       FROM calls c WHERE c.start_time BETWEEN $1 AND $2 AND c.queue_name IS NOT NULL
       GROUP BY c.queue_name ORDER BY offered DESC`,
      [from, to]
    );
    rows = r.rows;
    columns = ['queue_name','offered','answered','abandoned_queue','abandoned_agent','asa_seconds','aht_seconds','abandon_rate_pct','sla_pct'];

  } else if (type === 'agent-performance') {
    const r = await query(
      `SELECT ah.agent_id, a.full_name,
         COUNT(*)::INT AS calls_offered,
         COUNT(*) FILTER (WHERE ah.missed=false AND ah.talk_start IS NOT NULL)::INT AS calls_answered,
         COUNT(*) FILTER (WHERE ah.missed=true)::INT AS calls_missed,
         ROUND(COALESCE(
           SUM(ah.talk_seconds) FILTER (WHERE ah.missed=false)::NUMERIC
           / NULLIF(COUNT(*) FILTER (WHERE ah.missed=false AND ah.talk_start IS NOT NULL),0)
           / 60.0, 0), 2) AS aht_min,
         ROUND(COALESCE(SUM(ah.talk_seconds) FILTER (WHERE ah.missed=false)::NUMERIC/60.0,0),2) AS total_talk_min
       FROM agent_history ah
       LEFT JOIN agents a ON a.agent_id=ah.agent_id
       WHERE ah.ring_start BETWEEN $1 AND $2
       GROUP BY ah.agent_id, a.full_name
       ORDER BY calls_answered DESC`,
      [from, to]
    );
    rows = r.rows;
    columns = ['agent_id','full_name','calls_offered','calls_answered','calls_missed','aht_min','total_talk_min'];

  } else if (type === 'call-volume') {
    const r = await query(
      `SELECT date_trunc('day',start_time)::DATE AS day,
         COUNT(*)::INT AS offered,
         COUNT(*) FILTER (WHERE disposition='answered')::INT AS answered,
         COUNT(*) FILTER (WHERE abandoned=true)::INT AS abandoned
       FROM calls WHERE start_time BETWEEN $1 AND $2
       GROUP BY day ORDER BY day ASC`,
      [from, to]
    );
    rows = r.rows;
    columns = ['day','offered','answered','abandoned'];

  } else if (type === 'ivr-paths') {
    // Three typed sections: dtmf | queue | other — same logic as ivrPathDistribution()
    const [dtmf, queues, other] = await Promise.all([
      query(
        `SELECT 'dtmf' AS type, digit_val AS label, COUNT(DISTINCT call_uuid)::INT AS calls
         FROM (
           SELECT c.call_uuid, step_obj->>'digit' AS digit_val
           FROM calls c, jsonb_array_elements(c.ivr_path) AS step_obj
           WHERE c.start_time BETWEEN $1 AND $2
             AND jsonb_array_length(c.ivr_path) > 0
             AND (step_obj->>'digit') IS NOT NULL
             AND (step_obj->>'digit') <> ''
         ) sub
         GROUP BY digit_val ORDER BY calls DESC`,
        [from, to]
      ),
      query(
        `SELECT 'queue' AS type, split_part(queue_name,'@',1) AS label, COUNT(*)::INT AS calls
         FROM calls
         WHERE start_time BETWEEN $1 AND $2
           AND queue_name IS NOT NULL
         GROUP BY split_part(queue_name,'@',1) ORDER BY calls DESC`,
        [from, to]
      ),
      query(
        `SELECT 'other' AS type, step_val AS label, COUNT(DISTINCT call_uuid)::INT AS calls
         FROM (
           SELECT c.call_uuid, COALESCE(step_obj->>'step','(unknown)') AS step_val
           FROM calls c, jsonb_array_elements(c.ivr_path) AS step_obj
           WHERE c.start_time BETWEEN $1 AND $2
             AND jsonb_array_length(c.ivr_path) > 0
             AND (step_obj->>'digit') IS NULL
             AND COALESCE(step_obj->>'app','') <> 'callcenter'
         ) sub
         GROUP BY step_val ORDER BY calls DESC`,
        [from, to]
      ),
    ]);
    rows    = [...dtmf.rows, ...queues.rows, ...other.rows];
    columns = ['type', 'label', 'calls'];

  } else {
    return res.status(400).json({ error: 'Invalid report type' });
  }

  const fromStr  = from.toISOString().slice(0, 10);
  const toStr    = to.toISOString().slice(0, 10);
  const filename = `${type}-${fromStr}-${toStr}`;

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    return res.json(rows);
  }

  const header = columns.join(',');
  const body   = rows.map(r =>
    columns.map(c => {
      const v = r[c] ?? '';
      return typeof v === 'string' && (v.includes(',') || v.includes('"'))
        ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(`${header}\n${body}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/cdr
//
// Full CDR report — joins call_history, agent_history, queue_history.
//
// Query params (all optional):
//   from        YYYY-MM-DD   start of range  (default: 7 days ago)
//   to          YYYY-MM-DD   end of range    (default: now, inclusive)
//   queue       queue name   filter by queue
//   agent       agent_id     filter by agent (use "unanswered" to list abandoned/timeout only)
//   disposition answered | abandoned | timeout | no_agent
//   limit       int          max rows (default 500, max 5000)
//   offset      int          pagination offset (default 0)
// ─────────────────────────────────────────────────────────────────────────────
export async function getCDRReport(req, res) {
  const { from, to } = dateRange(req);
  const queueFilter  = req.query.queue       || null;
  const agentFilter  = req.query.agent       || null;
  const dispFilter   = req.query.disposition || null;   // answered|abandoned_queue|abandoned_agent
  const limit        = Math.min(parseInt(req.query.limit)  || 500, 5000);
  const offset       = Math.max(parseInt(req.query.offset) || 0,   0);

  const conditions = ['ch.start_time BETWEEN $1 AND $2'];
  const params     = [from, to];
  let   p          = 3;

  if (queueFilter) {
    conditions.push(`ch.queue_name = $${p++}`);
    params.push(queueFilter);
  }
  if (agentFilter) {
    conditions.push(`ch.agent_id = $${p++}`);
    params.push(agentFilter);
  }
  // Translate the three UI disposition values to DB predicates.
  // DB has: disposition='answered' | disposition='abandoned' | ch.agent_id IS NULL/NOT NULL
  if (dispFilter === 'answered') {
    conditions.push(`ch.disposition = 'answered'`);
  } else if (dispFilter === 'abandoned_queue') {
    // Caller hung up before any agent was ever offered the call
    conditions.push(`ch.abandoned = true AND ch.agent_id IS NULL`);
    conditions.push(`NOT EXISTS (SELECT 1 FROM agent_history ah WHERE ah.call_uuid = ch.call_uuid)`);
  } else if (dispFilter === 'abandoned_agent') {
    // Agent was offered the call but missed; caller eventually hung up
    conditions.push(`ch.abandoned = true`);
    conditions.push(`EXISTS (SELECT 1 FROM agent_history ah WHERE ah.call_uuid = ch.call_uuid AND ah.missed = true)`);
  }

  const where = conditions.join(' AND ');

  const { rows } = await query(
    `SELECT
       ch.call_uuid,
       ch.ani,
       ch.dnis,
       ch.queue_name,

       -- ── Agent column ──────────────────────────────────────────────────────
       -- Answered: use calls.agent_id (set by bridge-agent-start, always correct)
       -- Abandoned-by-agent: show the most-recent agent who missed
       -- Abandoned-in-queue: NULL (no agent ever involved)
       CASE
         WHEN ch.agent_id IS NOT NULL
           THEN COALESCE(a_ans.full_name, ch.agent_id)
         WHEN ah_miss.agent_id IS NOT NULL
           THEN COALESCE(a_miss.full_name, ah_miss.agent_id)
         ELSE NULL
       END AS agent,

       -- ── Ring seconds ──────────────────────────────────────────────────────
       -- Answered: queue_enter_time → agent_answer_time (precise, from timestamps)
       -- Abandoned-by-agent: from agent_history.ring_seconds
       CASE
         WHEN ch.disposition = 'answered'
              AND ch.agent_answer_time IS NOT NULL
              AND ch.queue_enter_time  IS NOT NULL
           THEN EXTRACT(EPOCH FROM (ch.agent_answer_time - ch.queue_enter_time))::INT
         WHEN ch.abandoned = true AND ah_miss.ring_seconds IS NOT NULL
           THEN ah_miss.ring_seconds
         ELSE NULL
       END AS ring_seconds,

       -- ── Talk seconds ─────────────────────────────────────────────────────
       ch.talk_seconds,

       -- ── Abandoned seconds ────────────────────────────────────────────────
       -- Only populated when the call was NOT answered.
       -- Uses queue_enter_time → end_time (full wait time in system).
       CASE
         WHEN ch.abandoned = true
              AND ch.queue_enter_time IS NOT NULL
              AND ch.end_time         IS NOT NULL
           THEN EXTRACT(EPOCH FROM (ch.end_time - ch.queue_enter_time))::INT
         ELSE NULL
       END AS abandoned_seconds,

       -- ── Disposition ───────────────────────────────────────────────────────
       -- Three values surfaced to the UI:
       --   answered        → agent picked up
       --   abandoned_agent → agent was offered, did not answer; caller gave up
       --   abandoned_queue → caller hung up while waiting, no agent ever offered
       CASE
         WHEN ch.disposition = 'answered'
           THEN 'answered'
         WHEN ch.abandoned = true AND ah_miss.agent_id IS NOT NULL
           THEN 'abandoned_agent'
         WHEN ch.abandoned = true
           THEN 'abandoned_queue'
         ELSE COALESCE(ch.disposition, 'waiting')
       END AS disposition,

       -- ── Missed-by-agent (explicit field for ABANDONED_AGENT calls) ─────
       -- Shows which agent was offered but did not answer.
       -- NULL for answered calls and abandoned_queue calls.
       CASE
         WHEN ch.abandoned = true AND ah_miss.agent_id IS NOT NULL
           THEN COALESCE(a_miss.full_name, ah_miss.agent_id)
         ELSE NULL
       END AS missed_by_agent,

       -- ── All agent_history ring seconds for this call (for ring display) ─
       ah_miss.ring_seconds AS missed_ring_seconds,

       ch.start_time,
       ch.end_time,
       ch.ivr_path,
       COALESCE(q.display_name, ch.queue_name) AS queue_display_name

     FROM call_history ch

     -- Agent who answered: join directly on calls.agent_id (most reliable source)
     LEFT JOIN agents a_ans ON a_ans.agent_id = ch.agent_id

     -- Most-recent agent who missed (for abandoned_agent classification)
     LEFT JOIN LATERAL (
       SELECT agent_id, ring_seconds
       FROM   agent_history
       WHERE  call_uuid = ch.call_uuid AND missed = true
       ORDER  BY id DESC
       LIMIT  1
     ) ah_miss ON true

     LEFT JOIN agents a_miss ON a_miss.agent_id = ah_miss.agent_id
     LEFT JOIN queues q      ON q.name          = ch.queue_name

     WHERE ${where}
     ORDER BY ch.start_time DESC
     LIMIT  $${p}
     OFFSET $${p + 1}`,
    [...params, limit, offset]
  );

  res.json(rows);
}
