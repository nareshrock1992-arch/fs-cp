import { query } from '../db/pool.js';
import { cc } from '../services/eslService.js';
import * as agentSession from '../services/agentSessionService.js';

// Returns all agents with their assigned queues in a `queues` array
export async function listAgents(req, res) {
  const { rows } = await query(`
    SELECT
      a.id,
      a.agent_id,
      a.full_name,
      a.avaya_extension,
      a.contact,
      a.status,
      a.state,
      a.max_no_answer,
      a.wrap_up_time,
      a.reject_delay_time,
      a.busy_delay_time,
      a.active,
      a.created_at,
      a.updated_at,
      (a.pin_hash IS NOT NULL) AS pin_hash,   -- boolean: does an Agent Desktop PIN exist?
      ase.started_at           AS status_since, -- start of the current status segment (for idle timer)
      COALESCE(
        json_agg(
          json_build_object(
            'queue',    q.name,
            'level',    t.level,
            'position', t.position
          )
        ) FILTER (WHERE q.id IS NOT NULL),
        '[]'
      ) AS queues
    FROM agents a
    LEFT JOIN agent_tiers t ON t.agent_id = a.id
    LEFT JOIN queues q       ON q.id       = t.queue_id
    -- status_since: start of the current open status segment (Available or On Break)
    -- NULL if no open segment exists (e.g. Logged Out, or session service not running)
    LEFT JOIN LATERAL (
      SELECT started_at
      FROM   agent_state_events
      WHERE  agent_id = a.agent_id AND ended_at IS NULL
      LIMIT  1
    ) ase ON true
    GROUP BY a.id, ase.started_at
    ORDER BY a.full_name ASC
  `);
  res.json(rows);
}

export async function getAgent(req, res) {
  const { rows } = await query(`SELECT * FROM agents WHERE agent_id = $1`, [req.params.agentId]);
  if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });
  res.json(rows[0]);
}

export async function getAgentHistory(req, res) {
  const { agentId } = req.params;
  const { rows } = await query(
    `SELECT * FROM agent_state_log WHERE agent_id = $1 ORDER BY changed_at DESC LIMIT 200`,
    [agentId]
  );
  res.json(rows);
}

export async function createAgent(req, res) {
  const {
    agentId,
    fullName,
    avayaExtension,
    contact,
    maxNoAnswer    = 3,
    wrapUpTime     = 20,
    rejectDelayTime = 2,
    busyDelayTime   = 60
  } = req.body;

  if (!agentId || !fullName || !avayaExtension || !contact) {
    return res.status(400).json({ error: 'agentId, fullName, avayaExtension and contact are required' });
  }

  const { rows } = await query(
    `INSERT INTO agents
       (agent_id, full_name, avaya_extension, contact, max_no_answer, wrap_up_time, reject_delay_time, busy_delay_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [agentId, fullName, avayaExtension, contact, maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime]
  );

  try {
    await cc.agentAdd(agentId, contact);
    await cc.agentSetParam(agentId, 'max_no_answer',     maxNoAnswer);
    await cc.agentSetParam(agentId, 'wrap_up_time',      wrapUpTime);
    await cc.agentSetParam(agentId, 'reject_delay_time', rejectDelayTime);
    await cc.agentSetParam(agentId, 'busy_delay_time',   busyDelayTime);
  } catch (err) {
    console.error('[agents] FreeSWITCH sync failed on create:', err.message);
  }

  res.status(201).json(rows[0]);
}

export async function updateAgent(req, res) {
  const { agentId } = req.params;
  const {
    fullName, avayaExtension, contact,
    maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime, active
  } = req.body;

  const { rows } = await query(
    `UPDATE agents SET
       full_name         = COALESCE($2, full_name),
       avaya_extension   = COALESCE($3, avaya_extension),
       contact           = COALESCE($4, contact),
       max_no_answer     = COALESCE($5, max_no_answer),
       wrap_up_time      = COALESCE($6, wrap_up_time),
       reject_delay_time = COALESCE($7, reject_delay_time),
       busy_delay_time   = COALESCE($8, busy_delay_time),
       active            = COALESCE($9, active)
     WHERE agent_id = $1
     RETURNING *`,
    [agentId, fullName, avayaExtension, contact, maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime, active]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });

  try {
    if (contact)                    await cc.agentSetParam(agentId, 'contact',           contact);
    if (maxNoAnswer    !== undefined) await cc.agentSetParam(agentId, 'max_no_answer',     maxNoAnswer);
    if (wrapUpTime     !== undefined) await cc.agentSetParam(agentId, 'wrap_up_time',      wrapUpTime);
    if (rejectDelayTime !== undefined) await cc.agentSetParam(agentId, 'reject_delay_time', rejectDelayTime);
    if (busyDelayTime  !== undefined) await cc.agentSetParam(agentId, 'busy_delay_time',   busyDelayTime);
  } catch (err) {
    console.error('[agents] FreeSWITCH sync failed on update:', err.message);
  }

  res.json(rows[0]);
}

export async function deleteAgent(req, res) {
  const { agentId } = req.params;
  const { rowCount } = await query(`DELETE FROM agents WHERE agent_id = $1`, [agentId]);
  if (!rowCount) return res.status(404).json({ error: 'Agent not found' });
  try {
    await cc.agentDel(agentId);
  } catch (err) {
    console.error('[agents] FreeSWITCH sync failed on delete:', err.message);
  }
  res.status(204).end();
}

const VALID_STATUSES = ['Available', 'On Break', 'Logged Out'];
const VALID_STATES   = ['Waiting', 'Receiving', 'In a queue call'];

export async function setAgentStatus(req, res) {
  const { agentId } = req.params;
  const { status }  = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }
  try { await cc.agentSetStatus(agentId, status); } catch (e) { /* ESL offline */ }
  await query(`UPDATE agents SET status = $2 WHERE agent_id = $1`, [agentId, status]);
  await query(
    `INSERT INTO agent_state_log (agent_id, status, reason) VALUES ($1,$2,'manual')`,
    [agentId, status]
  );
  try { await agentSession.handleStatusTransition(agentId, status, 'manual'); }
  catch (err) { console.error('[sessions] setAgentStatus transition failed:', err.message); }
  res.json({ agentId, status });
}

export async function setAgentState(req, res) {
  const { agentId } = req.params;
  const { state }   = req.body;
  if (!VALID_STATES.includes(state)) {
    return res.status(400).json({ error: `state must be one of: ${VALID_STATES.join(', ')}` });
  }
  try { await cc.agentSetState(agentId, state); } catch (e) { /* ESL offline */ }
  await query(`UPDATE agents SET state = $2 WHERE agent_id = $1`, [agentId, state]);
  res.json({ agentId, state });
}
