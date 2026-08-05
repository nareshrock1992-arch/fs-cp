import { query } from '../db/pool.js';
import { cc } from '../services/eslService.js';

export async function listQueues(req, res) {
  const { rows } = await query(`SELECT * FROM queues ORDER BY display_name ASC`);
  res.json(rows);
}

export async function getQueue(req, res) {
  const { rows } = await query(`SELECT * FROM queues WHERE name = $1`, [req.params.queueName]);
  if (!rows[0]) return res.status(404).json({ error: 'Queue not found' });

  const tiers = await query(
    `SELECT t.level, t.position, a.agent_id, a.full_name, a.status, a.state
     FROM agent_tiers t JOIN agents a ON a.id = t.agent_id
     WHERE t.queue_id = (SELECT id FROM queues WHERE name = $1)
     ORDER BY t.level ASC, t.position ASC`,
    [req.params.queueName]
  );

  res.json({ ...rows[0], agents: tiers.rows });
}
export async function createQueue(req, res) {
  let { name, displayName, strategy = 'longest-idle-agent',
        maxWaitTime = 300, maxQueueSize = 50, mohSound } = req.body;

  if (!name || !displayName) {
    return res.status(400).json({ error: 'name and displayName are required' });
  }

  // Normalize + sanitize queue name
  if (!name.includes('@')) name = `${name}@default`;
  name = name.replace(/[^a-zA-Z0-9_\-@.]/g, '');

  const { rows } = await query(
    `INSERT INTO queues (name, display_name, strategy, max_wait_time, max_queue_size, moh_sound)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6, 'local_stream://moh')) RETURNING *`,
    [name, displayName, strategy, maxWaitTime, maxQueueSize, mohSound]
  );

  try {
    await cc.queueAdd(name);
    await cc.queueSetParam(name, 'strategy',      strategy);
    await cc.queueSetParam(name, 'moh-sound',     rows[0].moh_sound);
    await cc.queueSetParam(name, 'max-wait-time', maxWaitTime);
    // max-queue-size is NOT settable via callcenter_config queue set (not a valid FS param)
  } catch (err) {
    console.error('[queues] FreeSWITCH sync failed on create:', err.message);
  }

  res.status(201).json(rows[0]);
}



export async function updateQueue(req, res) {
  const { queueName } = req.params;
  const { displayName, strategy, maxWaitTime, maxQueueSize, active } = req.body;

  const { rows } = await query(
    `UPDATE queues SET
       display_name = COALESCE($2, display_name),
       strategy = COALESCE($3, strategy),
       max_wait_time = COALESCE($4, max_wait_time),
       max_queue_size = COALESCE($5, max_queue_size),
       active = COALESCE($6, active)
     WHERE name = $1 RETURNING *`,
    [queueName, displayName, strategy, maxWaitTime, maxQueueSize, active]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Queue not found' });

  try {
    if (strategy)                  await cc.queueSetParam(queueName, 'strategy',      strategy);
    if (maxWaitTime !== undefined) await cc.queueSetParam(queueName, 'max-wait-time', maxWaitTime);
  } catch (err) {
    console.error('[queues] FreeSWITCH sync failed on update:', err.message);
  }

  res.json(rows[0]);
}

export async function deleteQueue(req, res) {
  const { queueName } = req.params;
  const { rowCount } = await query(`DELETE FROM queues WHERE name = $1`, [queueName]);
  if (!rowCount) return res.status(404).json({ error: 'Queue not found' });
  try {
    await cc.queueDel(queueName);
  } catch (err) {
    console.error('[queues] FreeSWITCH sync failed on delete:', err.message);
  }
  res.status(204).end();
}

// ---- Tiers (agent <-> queue assignment) ----

export async function addTier(req, res) {
  const { queueName } = req.params;
  const { agentId, level = 1, position = 1 } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId is required' });

  const queue = await query(`SELECT id FROM queues WHERE name = $1`, [queueName]);
  const agent = await query(`SELECT id FROM agents WHERE agent_id = $1`, [agentId]);
  if (!queue.rows[0]) return res.status(404).json({ error: 'Queue not found' });
  if (!agent.rows[0]) return res.status(404).json({ error: 'Agent not found' });

  await query(
    `INSERT INTO agent_tiers (agent_id, queue_id, level, position) VALUES ($1,$2,$3,$4)
     ON CONFLICT (agent_id, queue_id) DO UPDATE SET level = $3, position = $4`,
    [agent.rows[0].id, queue.rows[0].id, level, position]
  );

  try {
    await cc.tierAdd(queueName, agentId, level, position);
  } catch (err) {
    console.error('[queues] FreeSWITCH sync failed on tier add:', err.message);
  }

  res.status(201).json({ queueName, agentId, level, position });
}

export async function removeTier(req, res) {
  const { queueName, agentId } = req.params;
  const queue = await query(`SELECT id FROM queues WHERE name = $1`, [queueName]);
  const agent = await query(`SELECT id FROM agents WHERE agent_id = $1`, [agentId]);
  if (queue.rows[0] && agent.rows[0]) {
    await query(`DELETE FROM agent_tiers WHERE queue_id = $1 AND agent_id = $2`, [
      queue.rows[0].id,
      agent.rows[0].id
    ]);
  }
  try {
    await cc.tierDel(queueName, agentId);
  } catch (err) {
    console.error('[queues] FreeSWITCH sync failed on tier del:', err.message);
  }
  res.status(204).end();
}
