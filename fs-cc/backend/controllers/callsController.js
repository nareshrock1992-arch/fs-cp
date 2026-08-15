import { query } from '../db/pool.js';
import { cc } from '../services/eslService.js';

export async function listLiveCalls(req, res) {
  const { rows } = await query(`
    SELECT
      c.call_uuid,
      c.ani,
      c.dnis,
      c.vdn,
      c.ivr_option,
      c.ivr_path,
      c.queue_name,
      c.agent_id,
      c.queue_enter_time,
      c.agent_answer_time,
      c.disposition,
      EXTRACT(EPOCH FROM (now() - c.queue_enter_time))::INT  AS seconds_in_queue,
      EXTRACT(EPOCH FROM (now() - c.agent_answer_time))::INT AS seconds_on_call,
      a.full_name       AS agent_name,
      a.avaya_extension AS agent_extension
    FROM calls c
    LEFT JOIN agents a ON a.agent_id = c.agent_id
    WHERE c.end_time IS NULL
      AND c.disposition IN ('waiting', 'answered')
      AND c.start_time > now() - interval '6 hours'
    ORDER BY c.queue_enter_time ASC NULLS LAST
  `);
  res.json(rows);
}

export async function getQueueMembersLive(req, res) {
  try {
    const members = await cc.queueListMembers(req.params.queueName);
    res.json(members);
  } catch (err) {
    res.status(503).json({ error: 'FreeSWITCH ESL unavailable', detail: err.message });
  }
}

export async function listRecentCalls(req, res) {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const { rows } = await query(
    `SELECT
       c.call_uuid, c.ani, c.dnis, c.queue_name, c.agent_id,
       c.queue_enter_time, c.agent_answer_time, c.end_time,
       c.wait_seconds, c.talk_seconds, c.disposition, c.abandoned,
       c.ivr_path,
       a.full_name AS agent_name
     FROM calls c
     LEFT JOIN agents a ON a.agent_id = c.agent_id
     WHERE c.end_time IS NOT NULL
     ORDER BY c.end_time DESC
     LIMIT $1`,
    [limit]
  );
  res.json(rows);
}
