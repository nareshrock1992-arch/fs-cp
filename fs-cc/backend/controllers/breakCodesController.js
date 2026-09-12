import { query } from '../db/pool.js';
import { writeAudit, staffActor } from '../services/auditService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Break Codes — supervisor/admin configuration of agent break reasons.
//
// Break codes are business configuration stored in the break_codes table
// (migration 007), NOT frontend constants. Deactivation is a soft lifecycle
// change (active=false); rows are never hard-deleted, so historical break
// records (which snapshot break_code + break_name) remain valid.
//
// Authorization is enforced at the route layer:
//   • read  → requireAuth (any authenticated staff user)
//   • write → requirePermission('manage_break_codes') (admin implicit-all)
// ─────────────────────────────────────────────────────────────────────────────

const CODE_RE   = /^[A-Z0-9_]{2,64}$/;
const COLOR_RE  = /^#?[0-9A-Fa-f]{3,8}$/;

function normalizeCode(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

// Returns { ok:true, value } or { ok:false, error } for a create/update payload.
// `partial` allows PUT to omit unchanged fields (only validates supplied ones).
function validatePayload(body, { partial = false } = {}) {
  const out = {};

  // code — required on create, immutable-normalized on update if supplied
  if (!partial || body.code !== undefined) {
    const code = normalizeCode(body.code);
    if (!code)                return { ok: false, error: 'code is required' };
    if (!CODE_RE.test(code))  return { ok: false, error: 'code must be 2–64 chars: A–Z, 0–9, underscore' };
    out.code = code;
  }

  // name — required on create
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name)               return { ok: false, error: 'name is required' };
    if (name.length > 128)   return { ok: false, error: 'name must be at most 128 characters' };
    out.name = name;
  }

  if (body.description !== undefined) {
    const d = body.description === null ? null : String(body.description).trim();
    if (d && d.length > 2000) return { ok: false, error: 'description must be at most 2000 characters' };
    out.description = d || null;
  }

  if (body.display_order !== undefined) {
    const n = Number(body.display_order);
    if (!Number.isInteger(n) || n < 0 || n > 100000)
      return { ok: false, error: 'display_order must be an integer between 0 and 100000' };
    out.display_order = n;
  }

  if (body.color !== undefined) {
    const c = body.color === null ? null : String(body.color).trim();
    if (c && !COLOR_RE.test(c)) return { ok: false, error: 'color must be a hex value like #3B82F6' };
    out.color = c || null;
  }

  if (body.icon !== undefined) {
    const i = body.icon === null ? null : String(body.icon).trim();
    if (i && i.length > 64) return { ok: false, error: 'icon must be at most 64 characters' };
    out.icon = i || null;
  }

  if (body.agent_selectable !== undefined) {
    if (typeof body.agent_selectable !== 'boolean')
      return { ok: false, error: 'agent_selectable must be a boolean' };
    out.agent_selectable = body.agent_selectable;
  }

  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean')
      return { ok: false, error: 'active must be a boolean' };
    out.active = body.active;
  }

  for (const key of ['max_duration_seconds', 'warn_threshold_seconds']) {
    if (body[key] !== undefined) {
      if (body[key] === null) { out[key] = null; continue; }
      const n = Number(body[key]);
      if (!Number.isInteger(n) || n <= 0 || n > 86400)
        return { ok: false, error: `${key} must be a positive integer of seconds (max 86400)` };
      out[key] = n;
    }
  }

  // Cross-field: warning threshold must not exceed max duration when both known.
  const maxD  = out.max_duration_seconds;
  const warnD = out.warn_threshold_seconds;
  if (maxD != null && warnD != null && warnD > maxD)
    return { ok: false, error: 'warn_threshold_seconds must be less than or equal to max_duration_seconds' };

  return { ok: true, value: out };
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ── GET /api/break-codes ─────────────────────────────────────────────────────
// Lists all break codes (active + inactive) for management. Optional ?active=true
// to filter. Ordered by display_order then name.
export async function listBreakCodes(req, res) {
  const { active } = req.query;
  const params = [];
  let where = '';
  if (active === 'true' || active === 'false') {
    params.push(active === 'true');
    where = `WHERE active = $1`;
  }
  const { rows } = await query(
    `SELECT id, code, name, description, active, display_order, color, icon,
            agent_selectable, max_duration_seconds, warn_threshold_seconds,
            created_by, updated_by, created_at, updated_at
       FROM break_codes
       ${where}
       ORDER BY display_order ASC, name ASC`,
    params
  );
  res.json(rows);
}

// ── POST /api/break-codes ────────────────────────────────────────────────────
export async function createBreakCode(req, res) {
  const v = validatePayload(req.body || {}, { partial: false });
  if (!v.ok) return res.status(400).json({ error: v.error });

  const p = v.value;
  const { actor } = staffActor(req);

  try {
    const { rows } = await query(
      `INSERT INTO break_codes
         (code, name, description, display_order, color, icon,
          agent_selectable, max_duration_seconds, warn_threshold_seconds,
          active, created_by, updated_by)
       VALUES ($1,$2,$3,COALESCE($4,0),$5,$6,
               COALESCE($7,true),$8,$9,
               COALESCE($10,true),$11,$11)
       RETURNING *`,
      [p.code, p.name, p.description ?? null, p.display_order ?? null, p.color ?? null,
       p.icon ?? null, p.agent_selectable ?? null, p.max_duration_seconds ?? null,
       p.warn_threshold_seconds ?? null, p.active ?? null, actor]
    );
    const created = rows[0];
    const { actorRole } = staffActor(req);
    await writeAudit({
      actor, actorRole, action: 'BREAK_CODE_CREATED',
      entityType: 'break_code', entityId: created.code, newValue: created,
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A break code with that code already exists' });
    throw err;
  }
}

// ── PUT /api/break-codes/:id ─────────────────────────────────────────────────
export async function updateBreakCode(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid break code id' });

  const v = validatePayload(req.body || {}, { partial: true });
  if (!v.ok) return res.status(400).json({ error: v.error });
  const p = v.value;
  if (Object.keys(p).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  const before = await query(`SELECT * FROM break_codes WHERE id = $1`, [id]);
  if (!before.rows[0]) return res.status(404).json({ error: 'Break code not found' });

  // Re-validate cross-field rule against the MERGED result (partial updates).
  const merged = { ...before.rows[0], ...p };
  if (merged.max_duration_seconds != null && merged.warn_threshold_seconds != null
      && merged.warn_threshold_seconds > merged.max_duration_seconds)
    return res.status(400).json({ error: 'warn_threshold_seconds must be less than or equal to max_duration_seconds' });

  const { actor, actorRole } = staffActor(req);

  // Build a parameterized dynamic SET from only the supplied, validated fields.
  const cols = [];
  const vals = [];
  let i = 1;
  for (const [k, val] of Object.entries(p)) {
    cols.push(`${k} = $${i++}`);
    vals.push(val);
  }
  cols.push(`updated_by = $${i++}`); vals.push(actor);
  vals.push(id);

  try {
    const { rows } = await query(
      `UPDATE break_codes SET ${cols.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    await writeAudit({
      actor, actorRole, action: 'BREAK_CODE_UPDATED',
      entityType: 'break_code', entityId: rows[0].code,
      oldValue: before.rows[0], newValue: rows[0],
    });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A break code with that code already exists' });
    throw err;
  }
}

// ── PATCH /api/break-codes/:id/status ────────────────────────────────────────
// Soft enable/disable. Never deletes; historical records remain valid.
export async function setBreakCodeStatus(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid break code id' });

  const { active } = req.body || {};
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be a boolean' });

  const before = await query(`SELECT * FROM break_codes WHERE id = $1`, [id]);
  if (!before.rows[0]) return res.status(404).json({ error: 'Break code not found' });

  const { actor, actorRole } = staffActor(req);
  const { rows } = await query(
    `UPDATE break_codes SET active = $2, updated_by = $3 WHERE id = $1 RETURNING *`,
    [id, active, actor]
  );
  await writeAudit({
    actor, actorRole,
    action: active ? 'BREAK_CODE_ACTIVATED' : 'BREAK_CODE_DEACTIVATED',
    entityType: 'break_code', entityId: rows[0].code,
    oldValue: { active: before.rows[0].active }, newValue: { active },
  });
  res.json(rows[0]);
}
