import bcrypt from 'bcryptjs';
import jwt    from 'jsonwebtoken';
import { query }      from '../db/pool.js';
import { JWT_SECRET } from '../middleware/auth.js';

const TOKEN_TTL = process.env.JWT_TTL || '8h';

export async function login(req, res) {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const { rows } = await query(
    `SELECT id, username, password_hash, role, permissions FROM users WHERE username = $1`,
    [username.trim().toLowerCase()]
  );

  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const permissions = user.permissions ?? [];
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, permissions },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );

  res.json({ token, user: { id: user.id, username: user.username, role: user.role, permissions } });
}

export function me(req, res) {
  // req.user is set by requireAuth middleware
  res.json({ user: req.user });
}
