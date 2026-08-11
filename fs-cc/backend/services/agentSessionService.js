import { pool } from '../db/pool.js';

// ─────────────────────────────────────────────────────────────────────────────
// Agent Session Service
//
// Maintains two tables:
//   agent_sessions      — one row per contiguous login period
//   agent_state_events  — one row per contiguous status segment (Available | On Break)
//
// State machine (per agent):
//   NO_SESSION  ──[Available|On Break]──►  ACTIVE (session + state event opened)
//   ACTIVE      ──[same status]──────────►  ACTIVE (dedup: no-op)
//   ACTIVE      ──[different status, non-Logout]──► ACTIVE (close event, open new)
//   ACTIVE      ──[Logged Out]──────────►  NO_SESSION (close event + session)
//
// Deduplication rule:
//   If the currently open agent_state_events row already has status == newStatus,
//   the call is a no-op regardless of source or elapsed time. This silently
//   absorbs the duplicate that arrives when both the REST handler and the
//   FreeSWITCH ESL event fire for the same user action within ~200ms.
//
// All reads and writes for a single transition use ONE pool client so the
// check-then-act sequence is serialized within Node.js's single-threaded
// event loop. No advisory locks needed for a single-process deployment.
// ─────────────────────────────────────────────────────────────────────────────

// ── Internal helpers ─────────────────────────────────────────────────────────

async function getOpenSession(client, agentId) {
  const { rows } = await client.query(
    `SELECT id, login_at FROM agent_sessions
     WHERE agent_id = $1 AND logout_at IS NULL
     LIMIT 1`,
    [agentId]
  );
  return rows[0] || null;
}

async function getOpenEvent(client, agentId) {
  const { rows } = await client.query(
    `SELECT id, status, started_at FROM agent_state_events
     WHERE agent_id = $1 AND ended_at IS NULL
     LIMIT 1`,
    [agentId]
  );
  return rows[0] || null;
}

async function openSession(client, agentId) {
  // ON CONFLICT handles the race where two concurrent status events (e.g. agent_self
  // from the REST handler + fs_event from ESL ~200ms later) both see no open session
  // and both try to INSERT.  If the conflict fires, the UNION ALL falls through to
  // SELECT so we always return a valid session id.
  const { rows } = await client.query(
    `WITH ins AS (
       INSERT INTO agent_sessions (agent_id, login_at)
       VALUES ($1, now())
       ON CONFLICT (agent_id) WHERE logout_at IS NULL DO NOTHING
       RETURNING id
     )
     SELECT id FROM ins
     UNION ALL
     SELECT id FROM agent_sessions
       WHERE agent_id = $1 AND logout_at IS NULL
     LIMIT 1`,
    [agentId]
  );
  return rows[0].id;
}

async function closeSession(client, sessionId, reason) {
  await client.query(
    `UPDATE agent_sessions
     SET logout_at        = now(),
         duration_seconds = EXTRACT(EPOCH FROM (now() - login_at))::INT,
         logout_reason    = $2
     WHERE id = $1`,
    [sessionId, reason]
  );
}

async function openEvent(client, agentId, sessionId, status, source) {
  // ON CONFLICT handles the same dual-trigger race as openSession.
  // idx_ase_one_open enforces at most one open event per agent;
  // DO NOTHING lets the first writer win rather than throwing.
  await client.query(
    `INSERT INTO agent_state_events
       (agent_id, session_id, status, started_at, source)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (agent_id) WHERE ended_at IS NULL DO NOTHING`,
    [agentId, sessionId, status, source]
  );
}

async function closeEvent(client, eventId) {
  await client.query(
    `UPDATE agent_state_events
     SET ended_at         = now(),
         duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::INT
     WHERE id = $1`,
    [eventId]
  );
}

// ── Public: handle a single status transition ────────────────────────────────

/**
 * Process one agent status change from any source.
 *
 * @param {string} agentId   - FreeSWITCH agent name (e.g. 'alice@domain')
 * @param {string} newStatus - 'Available' | 'On Break' | 'Logged Out'
 * @param {string} source    - 'fs_event' | 'agent_self' | 'manual'
 */
export async function handleStatusTransition(agentId, newStatus, source) {
  const client = await pool.connect();
  try {
    const openSession_ = await getOpenSession(client, agentId);
    const openEvent_   = await getOpenEvent(client, agentId);

    if (newStatus === 'Logged Out') {
      if (!openSession_) return; // already logged out — no-op

      if (openEvent_) {
        await closeEvent(client, openEvent_.id);
      }
      await closeSession(client, openSession_.id, source);
      return;
    }

    // newStatus is 'Available' or 'On Break'

    // Dedup: same status already open — discard regardless of source
    if (openEvent_ && openEvent_.status === newStatus) return;

    // Close the current open event (different status)
    if (openEvent_) {
      await closeEvent(client, openEvent_.id);
    }

    // Open or reuse session
    let sessionId;
    if (!openSession_) {
      sessionId = await openSession(client, agentId);
    } else {
      sessionId = openSession_.id;
    }

    // Open new state event
    await openEvent(client, agentId, sessionId, newStatus, source);

  } finally {
    client.release();
  }
}

// ── Public: startup reconciliation ──────────────────────────────────────────

/**
 * Called once after ESL reconnects and cc.agentList() succeeds.
 * Closes open sessions for agents that FreeSWITCH reports as Logged Out
 * or that are absent from the FS agent list (removed from FS).
 * If agentList() threw (ESL unavailable), this function must NOT be called —
 * the caller is responsible for guarding.
 *
 * @param {Array<{name: string, status: string}>} agentList - result of cc.agentList()
 */
export async function reconcileOnStartup(agentList) {
  // Build a map from agentId → FS-reported status
  const fsMap = new Map();
  for (const a of agentList) {
    if (a.name) fsMap.set(a.name, a.status || 'Logged Out');
  }

  // Find all agents with open sessions
  const client = await pool.connect();
  try {
    const { rows: openSessions } = await client.query(
      `SELECT id, agent_id FROM agent_sessions WHERE logout_at IS NULL`
    );

    for (const session of openSessions) {
      const { id: sessionId, agent_id: agentId } = session;
      const fsStatus = fsMap.get(agentId);

      if (fsStatus === 'Logged Out' || fsStatus === undefined) {
        // Agent is logged out in FS or was removed — close the session
        const openEvent_ = await getOpenEvent(client, agentId);
        if (openEvent_) {
          await closeEvent(client, openEvent_.id);
        }
        await closeSession(client, sessionId, 'reconciliation');
        console.log(`[sessions] reconciled: ${agentId} closed (FS status: ${fsStatus ?? 'absent'})`);

      } else {
        // Agent is still active — check if open event status matches FS
        const openEvent_ = await getOpenEvent(client, agentId);

        if (!openEvent_) {
          // No open event — open one matching current FS status
          await openEvent(client, agentId, sessionId, fsStatus, 'reconciliation');
          console.log(`[sessions] reconciled: ${agentId} re-opened ${fsStatus} event`);

        } else if (openEvent_.status !== fsStatus) {
          // FS shows different status than what was open before restart
          // (missed a status change during the restart window)
          await closeEvent(client, openEvent_.id);
          await openEvent(client, agentId, sessionId, fsStatus, 'reconciliation');
          console.log(`[sessions] reconciled: ${agentId} corrected ${openEvent_.status} → ${fsStatus}`);
        }
        // openEvent_.status === fsStatus → no change needed
      }
    }
  } finally {
    client.release();
  }
}
