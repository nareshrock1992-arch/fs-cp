// Run:  node backend/scripts/seedUsers.js
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';

const USERS = [
  { username: 'admin',      password: 'admin123', role: 'admin' },
  { username: 'supervisor', password: 'super123', role: 'supervisor' }
];

for (const u of USERS) {
  const hash = await bcrypt.hash(u.password, 10);
  await query(
    `INSERT INTO users (username, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [u.username, hash, u.role]
  );
  console.log(`✓ seeded ${u.role}: ${u.username} / ${u.password}`);
}

console.log('\nChange these passwords before going to production!');
process.exit(0);
