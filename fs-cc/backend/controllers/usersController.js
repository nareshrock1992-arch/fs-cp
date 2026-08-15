import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';

const SAFE_COLS = `id, username, role, permissions, created_at`;

const VALID_PERMISSIONS = ['view_reports', 'change_agent_state'];

export async function listUsers(_req, res) {
  const { rows } = await query(`SELECT ${SAFE_COLS} FROM users ORDER BY created_at`);
  res.json(rows);
}

export async function createUser(req, res) {
  const { username, password, role = 'supervisor' } = req.body || {};
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  if (!['admin', 'supervisor'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or supervisor' });
  }
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3)
     RETURNING ${SAFE_COLS}`,
    [username.trim().toLowerCase(), hash, role]
  );
  res.status(201).json(rows[0]);
}

export async function updateUser(req, res) {
  const id = parseInt(req.params.id);
  const { username, role } = req.body || {};
  if (!username?.trim()) return res.status(400).json({ error: 'username is required' });
  if (!['admin', 'supervisor'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or supervisor' });
  }
  const { rows } = await query(
    `UPDATE users SET username=$1, role=$2 WHERE id=$3 RETURNING ${SAFE_COLS}`,
    [username.trim().toLowerCase(), role, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
}

export async function deleteUser(req, res) {
  const id = parseInt(req.params.id);
  // Prevent deleting the last admin
  const { rows: admins } = await query(
    `SELECT id FROM users WHERE role='admin' AND id <> $1`, [id]
  );
  const { rows: target } = await query(`SELECT role FROM users WHERE id=$1`, [id]);
  if (target[0]?.role === 'admin' && admins.length === 0) {
    return res.status(400).json({ error: 'Cannot delete the last admin account' });
  }
  await query(`DELETE FROM users WHERE id=$1`, [id]);
  res.status(204).end();
}

export async function updatePermissions(req, res) {
  const id = parseInt(req.params.id);
  const { permissions } = req.body || {};
  if (!Array.isArray(permissions)) {
    return res.status(400).json({ error: 'permissions must be an array' });
  }
  const invalid = permissions.filter(p => !VALID_PERMISSIONS.includes(p));
  if (invalid.length) {
    return res.status(400).json({ error: `Unknown permissions: ${invalid.join(', ')}` });
  }
  const { rows } = await query(
    `UPDATE users SET permissions=$1 WHERE id=$2 RETURNING ${SAFE_COLS}`,
    [permissions, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
}

export async function resetPassword(req, res) {
  const id = parseInt(req.params.id);
  const { password } = req.body || {};
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING ${SAFE_COLS}`,
    [hash, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
}
