// Run:  node backend/scripts/seedUsers.js
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';

// CC_ADMIN_PASSWORD may be injected at runtime via docker compose exec -e
const ADMIN_PASSWORD = process.env.CC_ADMIN_PASSWORD || 'admin123';

const USERS = [
  { username: 'admin',      password: ADMIN_PASSWORD, role: 'admin'      },
  { username: 'supervisor', password: 'super123',      role: 'supervisor' },
];

let created = 0;
for (const u of USERS) {
  const hash = await bcrypt.hash(u.password, 10);
  const { rowCount } = await query(
    `INSERT INTO users (username, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO NOTHING`,
    [u.username, hash, u.role]
  );
  if (rowCount > 0) {
    console.log(`✓ created ${u.role}: ${u.username}`);
    created++;
  } else {
    console.log(`- skipped ${u.role}: ${u.username} (already exists)`);
  }
}

if (created > 0) {
  console.log('\nChange default passwords before going to production!');
}
process.exit(0);
