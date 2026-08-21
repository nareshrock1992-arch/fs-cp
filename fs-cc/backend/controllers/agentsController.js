import { query } from '../db/pool.js';
import { cc } from '../services/eslService.js';
import { config } from '../config/index.js';
import * as agentSession from '../services/agentSessionService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Contact builder — single canonical location for PAI prefix enforcement
// ─────────────────────────────────────────────────────────────────────────────

// Every mod_callcenter agent contact that should carry P-Asserted-Identity must
// start with {sip_cid_type=pid}.  This causes FreeSWITCH sofia to generate the
// PAI header from effective_caller_id_name/number on the B-leg INVITE.
//
// Two endpoint types are supported:
//
//   internal — SIP user registered on the FreeSWITCH internal profile:
//     {sip_cid_type=pid}user/<extension>@<FS_SIP_DOMAIN>
//
//   gateway  — SIP call via a named gateway:
//     {sip_cid_type=pid}sofia/gateway/<gateway>/<destination>
//
// The function is deterministic and idempotent:
//   - Calling it twice with the same inputs produces the same output.
//   - An input that already contains {sip_cid_type=pid} is not double-prefixed.
export function buildContact({ agentType, extension, gateway, destination, contact }) {
  const PREFIX = '{sip_cid_type=pid}';

  if (agentType === 'internal') {
    if (!extension || !String(extension).trim()) {
      throw Object.assign(new Error('extension is required for internal agents'), { status: 400 });
    }
    const sipDomain = config.fs.sipDomain;
    if (!sipDomain) {
      throw Object.assign(
        new Error('FS_SIP_DOMAIN is not configured — cannot build internal agent contact'),
        { status: 500 }
      );
    }
    return `${PREFIX}user/${String(extension).trim()}@${sipDomain}`;
  }

  if (agentType === 'gateway') {
    if (!gateway || !String(gateway).trim()) {
      throw Object.assign(new Error('gateway is required for gateway agents'), { status: 400 });
    }
    if (!destination || !String(destination).trim()) {
      throw Object.assign(new Error('destination is required for gateway agents'), { status: 400 });
    }
    return `${PREFIX}sofia/gateway/${String(gateway).trim()}/${String(destination).trim()}`;
  }

  // Legacy / direct-contact path: caller supplied a raw contact string.
  // Normalize by stripping any existing {key=val} prefix blocks (idempotent),
  // then prepend the canonical prefix.
  if (contact && String(contact).trim()) {
    const raw     = String(contact).trim();
    const stripped = raw.replace(/^(\{[^}]*\})+/, '');
    return `${PREFIX}${stripped}`;
  }

  throw Object.assign(
    new Error('agentType (internal|gateway) or contact string is required'),
    { status: 400 }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agents CRUD
// ─────────────────────────────────────────────────────────────────────────────

// Returns all agents with their assigned queues in a `queues` array
export async function listAgents(req, res) {
  const { rows } = await query(`
    SELECT
      a.id,
      a.agent_id,
      a.full_name,
      a.avaya_extension,
      a.agent_type,
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
    // Structured fields (preferred)
    agentType,
    extension,
    gateway,
    destination,
    // Legacy raw contact (still accepted; normalized server-side)
    contact: rawContact,
    // Call behavior
    maxNoAnswer    = 3,
    wrapUpTime     = 20,
    rejectDelayTime = 2,
    busyDelayTime   = 60
  } = req.body;

  if (!agentId || !fullName || !avayaExtension) {
    return res.status(400).json({ error: 'agentId, fullName, and avayaExtension are required' });
  }

  let builtContact;
  try {
    builtContact = buildContact({ agentType, extension, gateway, destination, contact: rawContact });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const resolvedType = agentType || (rawContact && rawContact.includes('sofia/gateway') ? 'gateway' : 'internal');

  const { rows } = await query(
    `INSERT INTO agents
       (agent_id, full_name, avaya_extension, agent_type, contact,
        max_no_answer, wrap_up_time, reject_delay_time, busy_delay_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [agentId, fullName, avayaExtension, resolvedType, builtContact,
     maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime]
  );

  try {
    await cc.agentAdd(agentId, builtContact);
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
    fullName, avayaExtension,
    // Structured fields
    agentType,
    extension,
    gateway,
    destination,
    // Legacy raw contact
    contact: rawContact,
    // Call behavior
    maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime, active
  } = req.body;

  // Build normalized contact only when contact-related fields are present
  let builtContact = undefined;
  const hasContactChange = agentType || extension || gateway || destination || rawContact;
  if (hasContactChange) {
    try {
      builtContact = buildContact({ agentType, extension, gateway, destination, contact: rawContact });
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }

  const { rows } = await query(
    `UPDATE agents SET
       full_name         = COALESCE($2, full_name),
       avaya_extension   = COALESCE($3, avaya_extension),
       agent_type        = COALESCE($4, agent_type),
       contact           = COALESCE($5, contact),
       max_no_answer     = COALESCE($6, max_no_answer),
       wrap_up_time      = COALESCE($7, wrap_up_time),
       reject_delay_time = COALESCE($8, reject_delay_time),
       busy_delay_time   = COALESCE($9, busy_delay_time),
       active            = COALESCE($10, active)
     WHERE agent_id = $1
     RETURNING *`,
    [agentId, fullName, avayaExtension,
     agentType || null, builtContact || null,
     maxNoAnswer, wrapUpTime, rejectDelayTime, busyDelayTime, active]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Agent not found' });

  try {
    if (builtContact)                 await cc.agentSetParam(agentId, 'contact',           builtContact);
    if (maxNoAnswer    !== undefined)  await cc.agentSetParam(agentId, 'max_no_answer',     maxNoAnswer);
    if (wrapUpTime     !== undefined)  await cc.agentSetParam(agentId, 'wrap_up_time',      wrapUpTime);
    if (rejectDelayTime !== undefined) await cc.agentSetParam(agentId, 'reject_delay_time', rejectDelayTime);
    if (busyDelayTime  !== undefined)  await cc.agentSetParam(agentId, 'busy_delay_time',   busyDelayTime);
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
