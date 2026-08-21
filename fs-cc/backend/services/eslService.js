import esl from 'modesl';
import { EventEmitter } from 'events';
import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import * as agentSession from './agentSessionService.js';

const { host: FS_ESL_HOST, port: FS_ESL_PORT,
        password: FS_ESL_PASSWORD, reconnectMs: RECONNECT_MS } = config.esl;

export const ccEvents = new EventEmitter();
ccEvents.setMaxListeners(30);

// Namespace object so reaperCycle can cancel a previous interval on reconnect
const eslService = { _reaperTimer: null };

let conn         = null;
let connected    = false;
let reconnecting = false;  // guard: prevents duplicate retry loops

export function isConnected() { return connected; }

// Schedule a single reconnect attempt. The `reconnecting` flag ensures
// that concurrent triggers (esl::end + error on the same conn, or a
// stale old conn firing after we already replaced it) only produce one
// pending reconnect, not a storm.
let _reconnectAttempts = 0;
function scheduleReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  _reconnectAttempts++;
  console.warn(`[ESL] Reconnect attempt ${_reconnectAttempts} in ${RECONNECT_MS} ms …`);
  setTimeout(() => {
    reconnecting = false;
    connectESL();
  }, RECONNECT_MS);
}

// IVR steps buffer: chanUuid → [{ts,step,...}]
// Holds steps for callers in the IVR dialplan before they enter a queue.
// Flushed into the DB row when member-queue-start fires.
const ivrBuffer = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Polls mod_callcenter until it responds without an error.
// FreeSWITCH loads modules asynchronously after the ESL handshake, so
// "callcenter_config queue add" can return "-ERR no reply" if we push too soon.
async function waitForModCallcenter(maxWaitMs = 45_000) {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < maxWaitMs) {
    attempt++;
    try {
      const result = await eslApi('callcenter_config queue list');
      if (!result.startsWith('-ERR')) {
        console.log(`[esl] mod_callcenter ready (attempt ${attempt}, ${Date.now() - start}ms)`);
        return;
      }
      console.warn(`[esl] mod_callcenter not ready yet (attempt ${attempt}): ${result.slice(0, 80)}`);
    } catch (err) {
      console.warn(`[esl] mod_callcenter check error (attempt ${attempt}): ${err.message}`);
    }
    // Progressive back-off: 1s → 2s → 3s … capped at 5s
    await delay(Math.min(5000, 1000 * attempt));
  }
  throw new Error(`mod_callcenter did not become ready within ${maxWaitMs / 1000}s`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection
// ─────────────────────────────────────────────────────────────────────────────

export function connectESL() {
  console.log(`[ESL] Connecting to FreeSWITCH at ${FS_ESL_HOST}:${FS_ESL_PORT} …`);
  conn = new esl.Connection(FS_ESL_HOST, FS_ESL_PORT, FS_ESL_PASSWORD, async () => {
    connected = true;
    _reconnectAttempts = 0;  // reset counter on successful connect
    console.log(`[ESL] Connected to FreeSWITCH at ${FS_ESL_HOST}:${FS_ESL_PORT}`);
    ccEvents.emit('esl:status', { connected: true });

    // CRITICAL: CUSTOM must come AFTER plain event names.
    conn.events('plain',
      'CHANNEL_CREATE CHANNEL_ANSWER CHANNEL_EXECUTE DTMF CHANNEL_HANGUP_COMPLETE CUSTOM callcenter::info'
    );

    // Short pause to let the ESL handshake settle, then wait for
    // mod_callcenter to be ready before pushing DB state.
    await delay(500);
    runStartupSequence().catch(e =>
      console.error('[ESL] Startup sequence error:', e.message)
    );
  });

  // TCP-level error (e.g. ECONNREFUSED while FreeSWITCH is booting).
  // Without this retry, the reconnect loop dies after the first failed attempt.
  conn.on('error', err => {
    console.error('[ESL] Connection error:', err.message || err);
    if (connected) {
      // Treat a mid-session error as a disconnect
      connected = false;
      ccEvents.emit('esl:status', { connected: false });
      console.warn('[ESL] Marked OFFLINE');
    }
    scheduleReconnect();
  });

  conn.on('esl::end', () => {
    if (connected) {
      connected = false;
      ccEvents.emit('esl:status', { connected: false });
      console.warn('[ESL] Connection lost — Marked OFFLINE');
    }
    scheduleReconnect();
  });

  conn.on('esl::event::CUSTOM::*',                 evt => handleCallcenterEvent(evt));
  conn.on('esl::event::CHANNEL_CREATE::*',          evt => handleChannelCreate(evt));
  conn.on('esl::event::CHANNEL_ANSWER::*',          evt => handleChannelAnswer(evt));
  conn.on('esl::event::CHANNEL_EXECUTE::*',         evt => handleChannelExecute(evt));
  conn.on('esl::event::DTMF::*',                   evt => handleDtmf(evt));
  conn.on('esl::event::CHANNEL_HANGUP_COMPLETE::*', evt => handleChannelHangup(evt));

  return conn;
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw ESL API helpers
// ─────────────────────────────────────────────────────────────────────────────

export function eslApi(command) {
  return new Promise((resolve, reject) => {
    if (!conn || !connected) return reject(new Error('ESL not connected'));
    conn.api(command, res => {
      const body = res && res.getBody ? res.getBody() : '';
      resolve((body || '').trim());
    });
  });
}

async function eslApiSafe(command, label = command) {
  const result = await eslApi(command);
  if (result.startsWith('-ERR')) {
    if (/already exist|already have|already added/i.test(result)) return result;
    console.warn(`[esl] ${label}: ${result}`);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipe-delimited table parser for callcenter_config list output
// ─────────────────────────────────────────────────────────────────────────────

function parseFsTable(raw) {
  if (!raw) return [];
  const lines = raw.split('\n')
    .map(l => l.replace(/\r$/, '').trim())
    .filter(Boolean)
    .filter(l => !l.startsWith('+') && !l.startsWith('-') && !l.startsWith('ERR'));
  if (lines.length < 2) return [];
  const header = lines[0].split('|').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split('|');
    const row  = {};
    header.forEach((h, i) => { row[h] = (cols[i] ?? '').trim(); });
    return row;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// mod_callcenter API helpers
// ─────────────────────────────────────────────────────────────────────────────

export const cc = {
  agentAdd: (agentId, contact, type = 'callback') =>
    eslApiSafe(`callcenter_config agent add ${agentId} ${type}`, `agent add ${agentId}`)
      .then(() => eslApi(`callcenter_config agent set contact ${agentId} ${contact}`)),
  agentSetContact: (agentId, contact) =>
    eslApi(`callcenter_config agent set contact ${agentId} ${contact}`),
  agentDel:       (agentId)         => eslApi(`callcenter_config agent del ${agentId}`),
  agentSetStatus: (agentId, status) => eslApi(`callcenter_config agent set status ${agentId} '${status}'`),
  agentSetState:  (agentId, state)  => eslApi(`callcenter_config agent set state ${agentId} '${state}'`),
  agentSetParam:  (agentId, p, v)   => eslApi(`callcenter_config agent set ${p} ${agentId} ${v}`),

  queueAdd: (name) =>
    eslApiSafe(`callcenter_config queue add ${name}`, `queue add ${name}`),
  queueDel:      (name)       => eslApi(`callcenter_config queue del ${name}`),
  queueSetParam: (name, p, v) => eslApi(`callcenter_config queue set ${p} ${name} '${v}'`),

  tierAdd: (queue, agent, level = 1, pos = 1) =>
    eslApiSafe(`callcenter_config tier add ${queue} ${agent} ${level} ${pos}`,
               `tier add ${queue}/${agent}`),
  tierDel:      (queue, agent)        => eslApi(`callcenter_config tier del ${queue} ${agent}`),
  tierSetState: (queue, agent, state) => eslApi(`callcenter_config tier set state ${queue} ${agent} '${state}'`),

  agentList:        ()     => eslApi('callcenter_config agent list').then(parseFsTable),
  queueList:        ()     => eslApi('callcenter_config queue list').then(parseFsTable),
  tierList:         ()     => eslApi('callcenter_config tier list').then(parseFsTable),
  queueListMembers: (name) => eslApi(`callcenter_config queue list members ${name}`).then(parseFsTable),
  queueCount:       (name) => eslApi(`callcenter_config queue count ${name}`)
};

// ─────────────────────────────────────────────────────────────────────────────
// Hourly stats helper — called when a call is finalized
// ─────────────────────────────────────────────────────────────────────────────

async function updateHourlyStats(queueName, waitSec, talkSec, isAnswered, isAbandoned) {
  if (!queueName) return;

  // Get SLA threshold for this queue
  const { rows: qRows } = await query(
    `SELECT max_wait_time FROM queues WHERE name = $1`, [queueName]
  );
  const slaThreshold = qRows[0]?.max_wait_time ?? 300;
  const slaCount = isAnswered && (waitSec || 0) <= slaThreshold ? 1 : 0;

  await query(
    `INSERT INTO queue_stats_hourly
       (queue_name, hour_bucket, offered, answered, abandoned,
        total_wait_seconds, total_talk_seconds, sla_count, max_wait_seconds)
     VALUES ($1, date_trunc('hour', now()), 1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (queue_name, hour_bucket) DO UPDATE SET
       offered            = queue_stats_hourly.offered + 1,
       answered           = queue_stats_hourly.answered           + EXCLUDED.answered,
       abandoned          = queue_stats_hourly.abandoned          + EXCLUDED.abandoned,
       total_wait_seconds = queue_stats_hourly.total_wait_seconds + EXCLUDED.total_wait_seconds,
       total_talk_seconds = queue_stats_hourly.total_talk_seconds + EXCLUDED.total_talk_seconds,
       sla_count          = queue_stats_hourly.sla_count          + EXCLUDED.sla_count,
       max_wait_seconds   = GREATEST(queue_stats_hourly.max_wait_seconds, EXCLUDED.max_wait_seconds)`,
    [
      queueName,
      isAnswered  ? 1 : 0,
      isAbandoned ? 1 : 0,
      waitSec  || 0,
      talkSec  || 0,
      slaCount,
      waitSec  || 0
    ]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IVR tracking helpers
// ─────────────────────────────────────────────────────────────────────────────

const IVR_APPS = new Set([
  'menu', 'ivr', 'playback', 'play_and_get_digits',
  'read', 'phrase', 'speak', 'play_and_detect_speech', 'callcenter'
]);

function makeStep(fields) {
  return { ts: new Date().toISOString(), ...fields };
}

function bufferIvr(chanUuid, step) {
  if (!ivrBuffer.has(chanUuid)) {
    ivrBuffer.set(chanUuid, []);
    setTimeout(() => ivrBuffer.delete(chanUuid), 30 * 60 * 1000);
  }
  ivrBuffer.get(chanUuid).push(step);
}

// Write one IVR step:
//   • if the call row exists → append to ivr_path JSONB + insert ivr_history row
//   • if not yet in DB       → buffer locally until member-queue-start fires
async function appendIvrStep(chanUuid, step) {
  const stepJson = JSON.stringify([step]);
  const { rowCount, rows } = await query(
    `UPDATE calls
       SET ivr_path = ivr_path || $2::jsonb
     WHERE vdn = $1 AND end_time IS NULL
     RETURNING call_uuid, queue_name`,
    [chanUuid, stepJson]
  );

  if (rowCount > 0 && rows[0]) {
    // Also write to granular ivr_history table
    await query(
      `INSERT INTO ivr_history (call_uuid, vdn, queue_name, step_name, step_app, digit)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [rows[0].call_uuid, chanUuid, rows[0].queue_name,
       step.step, step.app || null, step.digit || null]
    ).catch(err => console.error('[esl] ivr_history insert:', err.message));
  } else {
    bufferIvr(chanUuid, step);
  }
}

// Flush buffered IVR steps into a newly-inserted call row
async function flushIvrBuffer(callUuid, chanUuid, queueName) {
  const steps = ivrBuffer.get(chanUuid);
  if (!steps || steps.length === 0) return;
  ivrBuffer.delete(chanUuid);

  await query(
    `UPDATE calls SET ivr_path = $2::jsonb WHERE call_uuid = $1`,
    [callUuid, JSON.stringify(steps)]
  );

  // Write each buffered step to ivr_history
  for (const step of steps) {
    await query(
      `INSERT INTO ivr_history (call_uuid, vdn, queue_name, step_name, step_app, digit, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [callUuid, chanUuid, queueName,
       step.step, step.app || null, step.digit || null,
       step.ts ? new Date(step.ts) : new Date()]
    ).catch(err => console.error('[esl] ivr_history flush:', err.message));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// pushToFreeSWITCH — PostgreSQL → FreeSWITCH
// ─────────────────────────────────────────────────────────────────────────────

export async function pushToFreeSWITCH() {
  console.log('[esl] ► pushToFreeSWITCH: rebuilding FreeSWITCH state from PostgreSQL …');

  // ── Fetch all data from DB first (3 queries total, not N) ─────────────────
  const [{ rows: queues }, { rows: agents }, { rows: tiers }] = await Promise.all([
    query(`SELECT id, name, strategy, moh_sound, max_wait_time, max_wait_time_w_no_agent
           FROM queues WHERE active = true ORDER BY name`),
    query(`SELECT agent_id, contact, status, max_no_answer, wrap_up_time,
                  reject_delay_time, busy_delay_time
           FROM agents WHERE active = true ORDER BY agent_id`),
    query(`SELECT a.agent_id, q.name AS queue_name, t.level, t.position
           FROM agent_tiers t
           JOIN agents a ON a.id = t.agent_id
           JOIN queues q ON q.id = t.queue_id
           WHERE a.active = true AND q.active = true`)
  ]);

  // ── Push queues (sequential — mod_callcenter is not thread-safe) ──────────
  for (const q of queues) {
    try {
      const addResult = await eslApiSafe(
        `callcenter_config queue add ${q.name}`, `queue add ${q.name}`
      );
      // If add returned a fatal error (not "already exists"), skip param updates
      if (addResult && addResult.startsWith('-ERR') &&
          !/already exist|already have/i.test(addResult)) {
        console.error(`[esl] push queue ${q.name} add failed: ${addResult}`);
        continue;
      }
      await eslApi(`callcenter_config queue set strategy ${q.name} '${q.strategy}'`);
      await eslApi(`callcenter_config queue set moh-sound ${q.name} '${q.moh_sound || 'local_stream://moh'}'`);
      await eslApi(`callcenter_config queue set max-wait-time ${q.name} ${q.max_wait_time}`);
      if (q.max_wait_time_w_no_agent)
        await eslApi(`callcenter_config queue set max-wait-time-with-no-agent ${q.name} ${q.max_wait_time_w_no_agent}`);
      await eslApi(`callcenter_config queue set agent-no-answer-status ${q.name} 'On Break'`);
    } catch (err) { console.error(`[esl] push queue ${q.name}:`, err.message); }
  }
  console.log(`[esl] ✓ pushed ${queues.length} queue(s)`);

  // ── Push agents ───────────────────────────────────────────────────────────
  for (const a of agents) {
    try {
      await eslApiSafe(`callcenter_config agent add ${a.agent_id} callback`, `agent add ${a.agent_id}`);
      await eslApi(`callcenter_config agent set contact ${a.agent_id} ${a.contact}`);
      await eslApi(`callcenter_config agent set status ${a.agent_id} '${a.status}'`);
      await eslApi(`callcenter_config agent set max_no_answer ${a.agent_id} ${a.max_no_answer}`);
      await eslApi(`callcenter_config agent set wrap_up_time ${a.agent_id} ${a.wrap_up_time}`);
      await eslApi(`callcenter_config agent set reject_delay_time ${a.agent_id} ${a.reject_delay_time}`);
      await eslApi(`callcenter_config agent set busy_delay_time ${a.agent_id} ${a.busy_delay_time}`);
    } catch (err) { console.error(`[esl] push agent ${a.agent_id}:`, err.message); }
  }
  console.log(`[esl] ✓ pushed ${agents.length} agent(s)`);

  // ── Push tiers ────────────────────────────────────────────────────────────
  for (const t of tiers) {
    try { await cc.tierAdd(t.queue_name, t.agent_id, t.level, t.position); }
    catch (err) { console.error(`[esl] push tier ${t.queue_name}/${t.agent_id}:`, err.message); }
  }
  console.log(`[esl] ✓ pushed ${tiers.length} tier(s)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// syncActiveCalls
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Ghost-call reaper helpers
// ─────────────────────────────────────────────────────────────────────────────

// Returns the set of CC member UUIDs currently active in FreeSWITCH.
// Two sources:
//   1. callcenter queue member list  — waiting or being offered calls
//   2. show channels json            — bridged channels (already answered)
//      We match by Unique-ID (= calls.vdn) since bridged calls left the member list.
async function getActiveFsUuids() {
  const activeMemberUuids = new Set();  // CC-Member-UUIDs
  const activeChannelVdns = new Set();  // channel UUIDs (calls.vdn)

  // ── Source 1: queue member list ───────────────────────────────────────────
  try {
    const { rows: queues } = await query('SELECT name FROM queues WHERE active = true');
    for (const q of queues) {
      try {
        const members = await cc.queueListMembers(q.name);
        members.forEach(m => {
          if (m.uuid)         activeMemberUuids.add(m.uuid.slice(0, 64));
          if (m.session_uuid) activeChannelVdns.add(m.session_uuid.slice(0, 64));
        });
      } catch {}
    }
  } catch {}

  // ── Source 2: active channels (catches bridged calls not in member list) ──
  try {
    const raw  = await eslApi('show channels as json');
    const data = JSON.parse(raw);
    (data.rows || []).forEach(r => {
      if (r.uuid) activeChannelVdns.add(r.uuid.slice(0, 64));
    });
  } catch {}

  return { activeMemberUuids, activeChannelVdns };
}

// Closed ghost calls — cross references BOTH the CC member UUID and the channel VDN
// so that bridged (answered) calls are not mistakenly reaped.
async function closeGhostCallsEnhanced(minAgeSeconds = 10) {
  const { activeMemberUuids, activeChannelVdns } = await getActiveFsUuids();
  const memberList  = Array.from(activeMemberUuids);
  const channelList = Array.from(activeChannelVdns);

  const { rowCount } = await query(
    `UPDATE calls SET
       end_time     = COALESCE(end_time, now()),
       abandoned    = CASE WHEN agent_answer_time IS NULL THEN true ELSE abandoned END,
       disposition  = CASE WHEN agent_answer_time IS NULL AND disposition = 'waiting'
                           THEN 'abandoned' ELSE disposition END,
       wait_seconds = CASE WHEN queue_enter_time IS NOT NULL AND wait_seconds IS NULL
                           THEN EXTRACT(EPOCH FROM (COALESCE(agent_answer_time, now()) - queue_enter_time))::INT
                           ELSE wait_seconds END,
       talk_seconds = CASE WHEN agent_answer_time IS NOT NULL AND talk_seconds IS NULL
                           THEN EXTRACT(EPOCH FROM (now() - agent_answer_time))::INT
                           ELSE talk_seconds END
     WHERE end_time IS NULL
       AND start_time < now() - ($3 * interval '1 second')
       -- not in the queue member list
       AND ($1::text[] IS NULL OR call_uuid != ALL($1::text[]))
       -- not a bridged channel still active
       AND ($2::text[] IS NULL OR vdn IS NULL OR vdn != ALL($2::text[]))`,
    [
      memberList.length  > 0 ? memberList  : null,
      channelList.length > 0 ? channelList : null,
      minAgeSeconds
    ]
  );
  if (rowCount > 0) {
    console.log(`[esl] ghost-reaper closed ${rowCount} stale call(s)`);
    ccEvents.emit('channel:hangup', { ghost: true, count: rowCount });
  }
}

// Periodic reaper — runs every 30 s while ESL is connected.
// Uses FreeSWITCH member list to identify truly active calls.
// Falls back to a conservative time-based sweep (30 min) when ESL is down.
async function reaperCycle() {
  try {
    if (connected) {
      await closeGhostCallsEnhanced(10);
    } else {
      // ESL offline — only close calls that have been waiting >30 min (safe fallback)
      await query(
        `UPDATE calls SET
           end_time     = now(),
           abandoned    = true,
           disposition  = 'abandoned',
           wait_seconds = EXTRACT(EPOCH FROM (now() - queue_enter_time))::INT
         WHERE end_time IS NULL
           AND agent_answer_time IS NULL
           AND queue_enter_time < now() - interval '30 minutes'`
      );
    }
  } catch (err) {
    console.error('[esl] reaperCycle:', err.message);
  }
}

async function syncActiveCalls() {
  console.log('[esl] ► syncActiveCalls: importing in-progress calls …');

  // ── Step 1: Find what FreeSWITCH considers active ──────────────────────────
  const { rows: queues } = await query('SELECT name FROM queues WHERE active = true');
  const activeUuids = new Set();
  const membersByQueue = {};

  for (const q of queues) {
    try {
      const members = await cc.queueListMembers(q.name);
      membersByQueue[q.name] = members;
      members.forEach(m => { if (m.uuid) activeUuids.add(m.uuid.slice(0, 64)); });
    } catch (err) { console.error(`[esl] queueListMembers ${q.name}:`, err.message); }
  }

  // ── Step 2: Close ghost calls (open in DB but not active in FS) ───────────
  // Enhanced version checks BOTH CC member UUIDs and bridged channel UUIDs so
  // answered calls are never falsely reaped.
  await closeGhostCallsEnhanced(5);

  // ── Step 3: Upsert active members into the calls table ────────────────────
  let imported = 0;
  for (const [queueName, members] of Object.entries(membersByQueue)) {
    for (const m of members) {
      const ccUuid   = (m.uuid             || '').slice(0, 64);
      const chanUuid = (m.session_uuid || m.uuid || '').slice(0, 64);
      if (!ccUuid) continue;

      const joinedEpoch  = parseInt(m.joined_epoch)  || 0;
      const bridgeEpoch  = parseInt(m.bridge_epoch)  || 0;
      const queueEnterTs = joinedEpoch ? new Date(joinedEpoch * 1000).toISOString() : null;
      const answerTs     = bridgeEpoch ? new Date(bridgeEpoch  * 1000).toISOString() : null;
      const agentId      = m.serving_agent || null;

      try {
        await query(
          `INSERT INTO calls
             (call_uuid, ani, dnis, vdn, queue_name, agent_id,
              queue_enter_time, agent_answer_time, disposition)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (call_uuid) DO UPDATE SET
             vdn               = COALESCE($4, calls.vdn),
             agent_id          = COALESCE($6, calls.agent_id),
             agent_answer_time = COALESCE($8, calls.agent_answer_time),
             disposition       = $9`,
          [ccUuid, (m.cid_number || '').slice(0, 64), '', chanUuid, queueName, agentId,
           queueEnterTs, answerTs, answerTs ? 'answered' : 'waiting']
        );
        imported++;
      } catch (err) { console.error(`[esl] syncActiveCalls upsert:`, err.message); }
    }
  }
  console.log(`[esl] ✓ imported ${imported} active calls`);
}

async function syncAgentStates() {
  try {
    const rows = await cc.agentList();
    for (const a of rows) {
      if (!a.name) continue;
      await query(
        `UPDATE agents SET status = $2, state = $3, updated_at = now() WHERE agent_id = $1`,
        [a.name, a.status || 'Logged Out', a.state || 'Logged Out']
      );
    }
  } catch (err) { console.error('[esl] syncAgentStates:', err.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup sequence
// ─────────────────────────────────────────────────────────────────────────────

async function runStartupSequence() {
  // ── Step 1: Wait for mod_callcenter to be ready ───────────────────────────
  // This is the fix for "-ERR no reply" on startup.  FreeSWITCH loads modules
  // asynchronously; we must not push config until callcenter responds normally.
  try {
    await waitForModCallcenter();
  } catch (err) {
    console.error('[esl] mod_callcenter never became ready:', err.message);
    // Continue anyway — some FS builds respond but return OK immediately.
  }

  // ── Step 2: Push DB config → FreeSWITCH ──────────────────────────────────
  try { await pushToFreeSWITCH(); }
  catch (err) { console.error('[esl] pushToFreeSWITCH failed:', err.message); }

  // ── Step 3: Give FS 2s to settle internal callcenter state ───────────────
  await delay(2000);

  // ── Step 4: Import active calls that were in progress before this restart ─
  try { await syncActiveCalls(); }
  catch (err) { console.error('[esl] syncActiveCalls failed:', err.message); }

  // ── Step 5: Sync agent state from FS → DB ────────────────────────────────
  try { await syncAgentStates(); }
  catch (err) { console.error('[esl] syncAgentStates failed:', err.message); }

  // Reconcile open agent sessions against current FreeSWITCH state.
  // This prevents false logouts — sessions stay open unless FS confirms logout.
  try {
    const agentList = await cc.agentList();
    await agentSession.reconcileOnStartup(agentList);
    console.log('[esl] ✓ session reconciliation complete');
  } catch (err) {
    // ESL may not be fully ready yet; leave sessions open rather than
    // guessing — they will self-correct as status events arrive.
    console.warn('[esl] session reconciliation skipped:', err.message);
  }

  ccEvents.emit('agent:update', { reason: 'startup' });
  console.log('[esl] ✓ startup sequence complete');

  // ── Step 6: Start the ghost-call reaper (every 30s) ──────────────────────
  // Clear any existing interval so reconnects don't stack multiple reapers.
  if (eslService._reaperTimer) clearInterval(eslService._reaperTimer);
  eslService._reaperTimer = setInterval(reaperCycle, 30_000);
  console.log('[ESL] Marked ONLINE');
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert helper for agent rows
// ─────────────────────────────────────────────────────────────────────────────

function deriveAgentDefaults(agentId) {
  const base     = agentId.split('@')[0];
  const fullName = base.replace(/_/g, ' ');
  const extMatch = base.match(/(\d+)$/);
  const ext      = extMatch ? extMatch[1] : '0000';
  return { fullName, ext, contact: `sofia/default/${ext}` };
}

async function upsertAgentStatus(agentId, status, state) {
  const { fullName, ext, contact } = deriveAgentDefaults(agentId);
  await query(
    `INSERT INTO agents (agent_id, full_name, avaya_extension, contact, status, state)
     VALUES ($1,$2,$3,$4,COALESCE($5,'Logged Out'),COALESCE($6,'Logged Out'))
     ON CONFLICT (agent_id) DO UPDATE SET
       status     = COALESCE($5, agents.status),
       state      = COALESCE($6, agents.state),
       updated_at = now()`,
    [agentId, fullName, ext, contact, status || null, state || null]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Missed-call helper
//
// FreeSWITCH does NOT always fire agent-no-answer when the caller abandons
// while a call is ringing at an agent. This function is the safety net called
// from every end-of-call path (member-queue-end, member-abandoned,
// handleChannelHangup). It marks any open agent_history rows (ring_end IS NULL,
// talk_start IS NULL) as missed so that:
//   • calls_missed increments in the Agent Performance report
//   • CDR classifies the call as abandoned_agent (not abandoned_queue)
// ─────────────────────────────────────────────────────────────────────────────

async function finaliseAgentHistoryMissed(callUuid) {
  if (!callUuid) return;
  try {
    const { rowCount } = await query(
      `UPDATE agent_history
         SET missed       = true,
             ring_end     = COALESCE(ring_end, now()),
             ring_seconds = COALESCE(
               ring_seconds,
               EXTRACT(EPOCH FROM (now() - ring_start))::INT
             )
       WHERE call_uuid  = $1
         AND missed     = false
         AND talk_start IS NULL`,
      [callUuid]
    );
    if (rowCount > 0) {
      console.log(`[esl] finaliseAgentHistoryMissed: marked ${rowCount} row(s) missed for ${callUuid}`);
    }
  } catch (err) {
    console.error('[esl] finaliseAgentHistoryMissed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// callcenter::info CUSTOM event handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleCallcenterEvent(evt) {
  const subclass = evt.getHeader('Event-Subclass');
  if (subclass !== 'callcenter::info') return;

  const action = evt.getHeader('CC-Action');
  if (!action) return;

  console.log(`[esl] CC-Action: ${action}`);

  switch (action) {

    // ── Agent status / state ─────────────────────────────────────────────────
    case 'agent-status-change': {
      const agentId = evt.getHeader('CC-Agent');
      const status  = evt.getHeader('CC-Agent-Status');
      if (!agentId) break;
      try {
        await upsertAgentStatus(agentId, status, null);
        await query(
          `INSERT INTO agent_state_log (agent_id, status, reason) VALUES ($1,$2,'fs_event')`,
          [agentId, status]
        );
        await agentSession.handleStatusTransition(agentId, status, 'fs_event');
      } catch (err) { console.error('[esl] agent-status-change:', err.message); }
      ccEvents.emit('agent:status', { agentId, status });
      break;
    }

    case 'agent-state-change': {
      const agentId = evt.getHeader('CC-Agent');
      const status  = evt.getHeader('CC-Agent-Status');
      const state   = evt.getHeader('CC-Agent-State');
      if (!agentId) break;
      try {
        await upsertAgentStatus(agentId, status, state);
        await query(
          `INSERT INTO agent_state_log (agent_id, status, state, reason) VALUES ($1,$2,$3,'fs_event')`,
          [agentId, status || null, state || null]
        );
      } catch (err) { console.error('[esl] agent-state-change:', err.message); }
      ccEvents.emit('agent:state', { agentId, status, state });
      break;
    }

    // ── Caller enters the queue ──────────────────────────────────────────────
    case 'member-queue-start': {
      const callUuid  = evt.getHeader('CC-Member-UUID');
      const chanUuid  = evt.getHeader('Unique-ID');
      const queueName = evt.getHeader('CC-Queue');
      const ani       = (evt.getHeader('CC-Member-CID-Number') || evt.getHeader('Caller-Caller-ID-Number') || '').slice(0, 64);
      const dnis      = (evt.getHeader('Caller-Destination-Number') || '').slice(0, 64);
      if (!callUuid) break;
      console.log(`[esl] member-queue-start ${callUuid} (chan:${chanUuid}) → ${queueName}`);
      try {
        await query(
          `INSERT INTO calls (call_uuid, ani, dnis, vdn, queue_name, queue_enter_time, disposition)
           VALUES ($1,$2,$3,$4,$5,now(),'waiting')
           ON CONFLICT (call_uuid) DO UPDATE SET
             vdn              = EXCLUDED.vdn,
             queue_name       = EXCLUDED.queue_name,
             queue_enter_time = EXCLUDED.queue_enter_time,
             disposition      = 'waiting'`,
          [callUuid, ani, dnis, (chanUuid || '').slice(0, 64), queueName]
        );
        if (chanUuid) await flushIvrBuffer(callUuid, chanUuid, queueName);
      } catch (err) { console.error('[esl] member-queue-start:', err.message); }
      ccEvents.emit('call:enqueued', { callUuid, queueName, ani, dnis });
      break;
    }

    // ── Caller abandoned ─────────────────────────────────────────────────────
    case 'member-abandoned':
    case 'queue-caller-abandoned': {
      const callUuid = evt.getHeader('CC-Member-UUID');
      if (!callUuid) break;
      try {
        const { rows } = await query(
          `UPDATE calls SET
             abandoned    = true,
             disposition  = 'abandoned',
             end_time     = COALESCE(end_time, now()),
             wait_seconds = CASE WHEN queue_enter_time IS NOT NULL
               THEN EXTRACT(EPOCH FROM (now() - queue_enter_time))::INT
               ELSE wait_seconds END
           WHERE call_uuid = $1 AND end_time IS NULL
           RETURNING queue_name, wait_seconds`,
          [callUuid]
        );
        if (rows[0]) {
          // ── Close any open agent_history rows as missed ───────────────────
          // FreeSWITCH does not always fire agent-no-answer when the caller
          // abandons while a call is ringing at an agent. This catches that gap.
          await finaliseAgentHistoryMissed(callUuid);

          await updateHourlyStats(rows[0].queue_name, rows[0].wait_seconds, 0, false, true)
            .catch(err => console.error('[esl] hourly stats abandoned:', err.message));
        }
      } catch (err) { console.error('[esl] member-abandoned:', err.message); }
      ccEvents.emit('call:abandoned', { callUuid });
      break;
    }

    // ── Agent answers — bridge starts ────────────────────────────────────────
    case 'bridge-agent-start': {
      const callUuid  = evt.getHeader('CC-Member-UUID');
      const agentId   = evt.getHeader('CC-Agent');
      const queueName = evt.getHeader('CC-Queue');
      if (!callUuid) break;
      console.log(`[esl] bridge-agent-start ${callUuid} → ${agentId}`);
      try {
        await query(
          `UPDATE calls SET
             agent_id          = $2,
             agent_answer_time = COALESCE(agent_answer_time, now()),
             disposition       = 'answered'
           WHERE call_uuid = $1`,
          [callUuid, agentId]
        );

        // UPDATE the agent-offering row (preferred path).
        // If no agent-offering row exists (missed ESL event), INSERT one instead.
        // Using CTE to avoid a double INSERT — agent_history has no unique
        // constraint so plain ON CONFLICT does nothing useful.
        await query(
          `WITH upd AS (
             UPDATE agent_history
               SET missed       = false,
                   ring_end     = COALESCE(ring_end, now()),
                   ring_seconds = COALESCE(ring_seconds,
                     EXTRACT(EPOCH FROM (now() - ring_start))::INT),
                   talk_start   = COALESCE(talk_start, now())
             WHERE call_uuid = $1
               AND agent_id  = $2
               AND talk_start IS NULL
             RETURNING id
           )
           INSERT INTO agent_history
             (call_uuid, agent_id, queue_name, ring_start, ring_end, ring_seconds, talk_start, missed)
           SELECT $1, $2, $3, now(), now(), 0, now(), false
           WHERE NOT EXISTS (SELECT 1 FROM upd)
           ON CONFLICT ON CONSTRAINT agent_history_call_agent_unique DO NOTHING`,
          [callUuid, agentId, queueName]
        );
      } catch (err) { console.error('[esl] bridge-agent-start:', err.message); }
      ccEvents.emit('call:bridged', { callUuid, agentId });
      break;
    }

    case 'bridge-agent-end': {
      const callUuid = evt.getHeader('CC-Member-UUID');
      const agentId  = evt.getHeader('CC-Agent');
      if (!callUuid) break;
      // Finalize talk_seconds on the agent_history row
      try {
        await query(
          `UPDATE agent_history
             SET talk_end      = now(),
                 talk_seconds  = EXTRACT(EPOCH FROM (now() - talk_start))::INT
           WHERE call_uuid    = $1
             AND agent_id     = $2
             AND missed       = false
             AND talk_start   IS NOT NULL
             AND talk_end     IS NULL`,
          [callUuid, agentId]
        );
      } catch (err) { console.error('[esl] bridge-agent-end agent_history:', err.message); }
      ccEvents.emit('call:bridge-end', { callUuid });
      break;
    }

    // ── Agent is being offered a call (ring starts) ──────────────────────────
    case 'agent-offering': {
      const callUuid  = evt.getHeader('CC-Member-UUID');
      const agentId   = evt.getHeader('CC-Agent');
      const queueName = evt.getHeader('CC-Queue');
      if (!callUuid || !agentId) break;
      console.log(`[esl] agent-offering ${callUuid} → ${agentId}`);
      try {
        await query(
          `INSERT INTO agent_history (call_uuid, agent_id, queue_name, ring_start, missed)
           VALUES ($1, $2, $3, now(), false)
           ON CONFLICT ON CONSTRAINT agent_history_call_agent_unique DO UPDATE SET
             ring_start   = CASE WHEN agent_history.missed = true
               THEN EXCLUDED.ring_start
               ELSE LEAST(agent_history.ring_start, EXCLUDED.ring_start) END,
             ring_end     = CASE WHEN agent_history.missed = true THEN NULL ELSE agent_history.ring_end END,
             ring_seconds = CASE WHEN agent_history.missed = true THEN NULL ELSE agent_history.ring_seconds END,
             missed       = CASE WHEN agent_history.missed = true THEN false ELSE agent_history.missed END,
             queue_name   = COALESCE(agent_history.queue_name, EXCLUDED.queue_name)
           WHERE agent_history.talk_start IS NULL`,
          [callUuid, agentId, queueName]
        );
      } catch (err) { console.error('[esl] agent-offering:', err.message); }
      ccEvents.emit('agent:offering', { callUuid, agentId });
      break;
    }

    // ── Agent did not answer (ring timed out) ────────────────────────────────
    case 'agent-no-answer': {
      const callUuid = evt.getHeader('CC-Member-UUID');
      const agentId  = evt.getHeader('CC-Agent');
      if (!callUuid || !agentId) break;
      console.log(`[esl] agent-no-answer ${callUuid} → ${agentId}`);
      try {
        await query(
          `UPDATE agent_history
             SET missed       = true,
                 ring_end     = now(),
                 ring_seconds = EXTRACT(EPOCH FROM (now() - ring_start))::INT
           WHERE call_uuid = $1 AND agent_id = $2 AND missed = false AND ring_end IS NULL`,
          [callUuid, agentId]
        );
        // Move agent to On Break (FS already does this via agent-no-answer-status,
        // but mirror the state in our DB)
        await query(
          `UPDATE agents SET status = 'On Break', updated_at = now() WHERE agent_id = $1`,
          [agentId]
        );
      } catch (err) { console.error('[esl] agent-no-answer:', err.message); }
      ccEvents.emit('agent:no-answer', { callUuid, agentId });
      break;
    }

    // ── Caller leaves the queue (primary end-of-call finalizer) ─────────────
    case 'member-queue-end': {
      const callUuid = evt.getHeader('CC-Member-UUID');
      if (!callUuid) break;
      console.log(`[esl] member-queue-end ${callUuid}`);
      try {
        const { rows } = await query(
          `UPDATE calls SET
             end_time     = COALESCE(end_time, now()),
             wait_seconds = CASE WHEN queue_enter_time IS NOT NULL
               THEN EXTRACT(EPOCH FROM (COALESCE(agent_answer_time, now()) - queue_enter_time))::INT
               ELSE wait_seconds END,
             talk_seconds = CASE WHEN agent_answer_time IS NOT NULL
               THEN EXTRACT(EPOCH FROM (now() - agent_answer_time))::INT
               ELSE talk_seconds END,
             abandoned   = CASE
               WHEN agent_answer_time IS NULL AND NOT abandoned THEN true
               ELSE abandoned END,
             disposition = CASE
               WHEN agent_answer_time IS NULL AND disposition = 'waiting' THEN 'abandoned'
               ELSE disposition END
           WHERE call_uuid = $1 AND end_time IS NULL
           RETURNING queue_name, wait_seconds, talk_seconds, disposition, abandoned,
                     agent_answer_time`,
          [callUuid]
        );
        if (rows[0]) {
          const r = rows[0];

          // Close any open agent_history rows as missed. Called unconditionally:
          // the WHERE talk_start IS NULL inside finaliseAgentHistoryMissed ensures
          // the answering agent's row (talk_start IS NOT NULL) is never touched.
          await finaliseAgentHistoryMissed(callUuid);

          await updateHourlyStats(
            r.queue_name,
            r.wait_seconds,
            r.talk_seconds,
            r.disposition === 'answered',
            r.abandoned
          ).catch(err => console.error('[esl] hourly stats queue-end:', err.message));
        }
      } catch (err) { console.error('[esl] member-queue-end:', err.message); }
      ccEvents.emit('call:bridge-end', { callUuid });
      break;
    }

    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IVR tracking: CHANNEL_EXECUTE
// ─────────────────────────────────────────────────────────────────────────────

async function handleChannelExecute(evt) {
  const chanUuid = evt.getHeader('Unique-ID');
  const app      = evt.getHeader('Application');
  if (!chanUuid || !app) return;

  const ivrStep = evt.getHeader('variable_ivr_step');
  const appData = evt.getHeader('Application-Data') || '';

  if (!IVR_APPS.has(app) && !ivrStep) return;

  let stepName;
  if (ivrStep) {
    stepName = ivrStep;
  } else if (app === 'playback' || app === 'phrase') {
    stepName = `play:${appData.split('/').pop().replace(/\.[^.]+$/, '').slice(0, 48)}`;
  } else if (app === 'callcenter') {
    stepName = `queue:${appData.split('@')[0].slice(0, 48)}`;
  } else if (app === 'play_and_get_digits' || app === 'read') {
    stepName = 'gather_digits';
  } else {
    stepName = app;
  }

  const step = makeStep({ step: stepName, app });
  try {
    await appendIvrStep(chanUuid.slice(0, 64), step);
  } catch (err) { console.error('[esl] handleChannelExecute:', err.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// IVR tracking: DTMF
// ─────────────────────────────────────────────────────────────────────────────

async function handleDtmf(evt) {
  const chanUuid = evt.getHeader('Unique-ID');
  const digit    = evt.getHeader('DTMF-Digit');
  if (!chanUuid || !digit) return;

  const step = makeStep({ step: `pressed_${digit}`, digit });
  try {
    await appendIvrStep(chanUuid.slice(0, 64), step);
  } catch (err) { console.error('[esl] handleDtmf:', err.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel lifecycle handlers
// ─────────────────────────────────────────────────────────────────────────────

function handleChannelCreate(evt) {
  ccEvents.emit('channel:create', {
    uuid: evt.getHeader('Unique-ID'),
    ani:  evt.getHeader('Caller-Caller-ID-Number'),
    dnis: evt.getHeader('Caller-Destination-Number')
  });
}

function handleChannelAnswer(evt) {
  ccEvents.emit('channel:answer', { uuid: evt.getHeader('Unique-ID') });
}

async function handleChannelHangup(evt) {
  // chanUuid = Unique-ID = caller channel UUID, stored in calls.vdn.
  // BACKUP finalizer — member-queue-end is primary.
  const chanUuid = evt.getHeader('Unique-ID');
  const cause    = evt.getHeader('Hangup-Cause');
  ivrBuffer.delete(chanUuid);
  try {
    const { rows, rowCount } = await query(
      `UPDATE calls SET
         end_time     = COALESCE(end_time, now()),
         abandoned    = CASE WHEN agent_answer_time IS NULL AND NOT abandoned THEN true ELSE abandoned END,
         disposition  = CASE WHEN agent_answer_time IS NULL AND disposition='waiting' THEN 'abandoned' ELSE disposition END,
         wait_seconds = CASE WHEN queue_enter_time IS NOT NULL AND wait_seconds IS NULL
           THEN EXTRACT(EPOCH FROM (COALESCE(agent_answer_time, now()) - queue_enter_time))::INT
           ELSE wait_seconds END,
         talk_seconds = CASE WHEN agent_answer_time IS NOT NULL AND talk_seconds IS NULL
           THEN EXTRACT(EPOCH FROM (now() - agent_answer_time))::INT
           ELSE talk_seconds END
       WHERE vdn = $1 AND end_time IS NULL
       RETURNING call_uuid, agent_answer_time`,
      [chanUuid]
    );
    // Backup: match by call_uuid in case vdn wasn't stored correctly
    let closedRows = rows;
    if (rowCount === 0) {
      const backup = await query(
        `UPDATE calls SET
           end_time    = COALESCE(end_time, now()),
           abandoned   = CASE WHEN agent_answer_time IS NULL AND NOT abandoned THEN true ELSE abandoned END,
           disposition = CASE WHEN agent_answer_time IS NULL AND disposition='waiting' THEN 'abandoned' ELSE disposition END
         WHERE call_uuid = $1 AND end_time IS NULL
         RETURNING call_uuid, agent_answer_time`,
        [chanUuid]
      );
      closedRows = backup.rows;
    }
    // Finalise agent_history for every closed call. Called unconditionally:
    // the WHERE talk_start IS NULL guard inside finaliseAgentHistoryMissed
    // ensures the answering agent's row is never incorrectly marked missed.
    for (const r of closedRows) {
      await finaliseAgentHistoryMissed(r.call_uuid);
    }
  } catch (err) { console.error('[esl] handleChannelHangup:', err.message); }
  ccEvents.emit('channel:hangup', { uuid: chanUuid, cause });
}
