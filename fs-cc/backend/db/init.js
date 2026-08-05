import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATIONS = [
  'schema.sql',
  'migrate_auth.sql',
  'migrate_ivr.sql',
  'migrate_reporting.sql',
  'migrate_cdr_views.sql',
  'migrate_indexes.sql',
  'migrate_agent_auth.sql',
];

async function main() {
  for (const file of MIGRATIONS) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[db:init] skipping ${file} (not found)`);
      continue;
    }
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`[db:init] applying ${file} …`);
    await pool.query(sql);
  }
  console.log('[db:init] ✓ all migrations applied.');
  await pool.end();
}

main().catch((err) => {
  console.error('[db:init] failed:', err.message);
  process.exit(1);
});
