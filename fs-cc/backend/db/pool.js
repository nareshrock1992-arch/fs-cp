import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

export const pool = new Pool(config.db);

pool.on('error', (err) => {
  console.error('[db] unexpected error on idle client', err);
});

export async function query(text, params) {
  const start = Date.now();
  const res   = await pool.query(text, params);
  const ms    = Date.now() - start;
  if (ms > 500) {
    console.warn(`[db] slow query (${ms}ms): ${text.slice(0, 120)}`);
  }
  return res;
}

// Pre-establish the first pool connection at server start so the first real
// query (e.g. from pushToFreeSWITCH) does not pay the TCP handshake cost.
export async function warmPool() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('[db] pool warmed up');
  } finally {
    client.release();
  }
}
