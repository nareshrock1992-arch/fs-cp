import { query } from '../db/pool.js';

// ─────────────────────────────────────────────────────────────────────────────
// Audit Service — minimal, single-table audit trail (audit_log, migration 007).
//
// Records material configuration changes (e.g. break-code create/update/enable/
// disable). NOT used for normal operational state changes such as ordinary agent
// status transitions. The actor identity is always taken from the authenticated
// request context — never from a request body.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write one audit record. Best-effort: an audit failure must never break the
 * primary operation, so callers may ignore rejections. Returns the inserted id
 * or null on failure.
 *
 * @param {object} entry
 * @param {string}  entry.actor        Authenticated user identity (username / agent_id)
 * @param {string}  entry.actorRole    'admin' | 'supervisor' | 'agent'
 * @param {string}  entry.action       e.g. 'BREAK_CODE_CREATED'
 * @param {string}  entry.entityType   e.g. 'break_code'
 * @param {string} [entry.entityId]    id/code of the affected entity
 * @param {object} [entry.oldValue]    before-state (will be JSON-serialised)
 * @param {object} [entry.newValue]    after-state (will be JSON-serialised)
 */
export async function writeAudit({ actor, actorRole, action, entityType, entityId, oldValue, newValue }) {
  try {
    const { rows } = await query(
      `INSERT INTO audit_log
         (actor, actor_role, action, entity_type, entity_id, old_value, new_value)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
       RETURNING id`,
      [
        actor ?? null,
        actorRole ?? null,
        action,
        entityType,
        entityId != null ? String(entityId) : null,
        oldValue != null ? JSON.stringify(oldValue) : null,
        newValue != null ? JSON.stringify(newValue) : null,
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error(`[audit] failed to record ${action} on ${entityType}:${entityId}:`, err.message);
    return null;
  }
}

/** Resolve the actor identity from a staff (requireAuth) request. */
export function staffActor(req) {
  return { actor: req.user?.username ?? String(req.user?.id ?? 'unknown'), actorRole: req.user?.role ?? 'unknown' };
}
