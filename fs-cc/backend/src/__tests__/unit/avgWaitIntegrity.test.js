/**
 * Dashboard Average Wait — data-integrity regression tests (P1 fix).
 *
 * Root cause: syncActiveCalls could persist an agent_answer_time earlier than
 * queue_enter_time (stale/reused member-list bridge_epoch), producing negative
 * wait_seconds, which then poisoned the Dashboard AVG(wait_seconds) KPI.
 *
 * Fix (3 layers), verified here:
 *   L1 — syncActiveCalls rejects an implausible bridge_epoch (must be >= join
 *        epoch) and only BACKFILLS agent_answer_time when NULL (never overwrites
 *        the authoritative bridge-agent-start value; never downgrades 'answered').
 *   L2 — call finalizers clamp wait_seconds with GREATEST(..., 0).
 *   L3 — Dashboard AVG excludes wait_seconds < 0 so historical corrupt rows
 *        cannot make the KPI negative.
 *
 * Repo has no DB harness (pg is mocked) → coverage = pure-logic mirrors of the
 * plausibility/AVG rules + SQL/source-shape guards on the actual code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../..');

// ── L1 logic mirror: the answer-time plausibility rule in syncActiveCalls ─────
// answerValid = bridgeEpoch && joinedEpoch && bridgeEpoch >= joinedEpoch
const answerTsPlausible = (joinedEpoch, bridgeEpoch) =>
  !!(bridgeEpoch && joinedEpoch && bridgeEpoch >= joinedEpoch);

// ── L3 logic mirror: AVG excluding invalid negatives ──────────────────────────
const avgValidWait = (list) => {
  const valid = list.filter(w => w != null && w >= 0);
  return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : 0;
};

const ep = (iso) => Math.floor(Date.parse(iso) / 1000); // seconds epoch

describe('L1 — bridge_epoch plausibility (syncActiveCalls)', () => {
  it('Test 1 — normal answer (bridge after join) is accepted', () => {
    expect(answerTsPlausible(ep('2026-09-12T10:00:00+03:00'), ep('2026-09-12T10:00:08+03:00'))).toBe(true);
  });
  it('Test 2 — answer exactly at queue entry is accepted (wait=0)', () => {
    const j = ep('2026-09-12T10:00:00+03:00');
    expect(answerTsPlausible(j, j)).toBe(true);
  });
  it('Test 3 — answer before queue entry is REJECTED (not persisted)', () => {
    expect(answerTsPlausible(ep('2026-09-12T10:00:00+03:00'), ep('2026-09-12T09:59:00+03:00'))).toBe(false);
  });
  it('Test 4 — the real stale-sync case (07:32 bridge vs 14:44 join) is REJECTED', () => {
    const joined = ep('2026-09-12T14:44:54+03:00');
    const bridge = ep('2026-09-12T07:32:36+03:00'); // stale/reused epoch
    expect(bridge < joined).toBe(true);
    expect(answerTsPlausible(joined, bridge)).toBe(false);
  });
  it('missing join epoch → cannot validate → rejected', () => {
    expect(answerTsPlausible(0, ep('2026-09-12T10:00:08+03:00'))).toBe(false);
  });
});

describe('L3 — Dashboard AVG excludes invalid negatives', () => {
  it('Test 5 — avg([10, 20, -25939]) excluding negatives = 15', () => {
    expect(avgValidWait([10, 20, -25939])).toBe(15);
  });
  it('Test 6 — normal averages unchanged (no negatives present)', () => {
    expect(avgValidWait([10, 20, 30])).toBe(20);
    expect(avgValidWait([])).toBe(0);
  });
});

// ── SQL-shape guard on the real Dashboard queries (L3) ────────────────────────
const captured = [];
vi.mock('../../../db/pool.js', () => ({
  query: vi.fn(async (sql) => { captured.push(String(sql)); return { rows: [{}] }; }),
  pool: {}, warmPool: vi.fn(),
}));
vi.mock('../../../services/eslService.js', () => ({ isConnected: () => false }));
const stats = await import('../../../controllers/statsController.js');
const mockRes = () => ({ json: vi.fn(), status: vi.fn(function () { return this; }) });

describe('L3 — real Dashboard SQL excludes wait_seconds < 0', () => {
  beforeEach(() => { captured.length = 0; });
  it('getDashboardStats callsToday AVG filters wait_seconds >= 0', async () => {
    await stats.getDashboardStats({}, mockRes());
    const all = captured.join('\n');
    expect(all).toMatch(/AVG\(wait_seconds\)\s*FILTER\s*\(WHERE wait_seconds IS NOT NULL AND wait_seconds >= 0\)/i);
  });
  it('getQueueStats avg_wait_today filters wait_seconds >= 0', async () => {
    await stats.getQueueStats({}, mockRes());
    const all = captured.join('\n');
    expect(all).toMatch(/AVG\(c\.wait_seconds\)[\s\S]*c\.wait_seconds >= 0[\s\S]*avg_wait_today/i);
  });
});

// ── Source-shape guard on eslService (L1 + L2) ────────────────────────────────
describe('L1/L2 — eslService write-path guards present', () => {
  const src = fs.readFileSync(path.join(BACKEND, 'services', 'eslService.js'), 'utf8');
  it('L1: syncActiveCalls validates bridge epoch >= join epoch', () => {
    expect(src).toMatch(/answerValid\s*=\s*bridgeEpoch\s*&&\s*joinedEpoch\s*&&\s*bridgeEpoch\s*>=\s*joinedEpoch/);
  });
  it('L1: syncActiveCalls backfills answer time only when NULL (no overwrite)', () => {
    expect(src).toMatch(/agent_answer_time\s*=\s*COALESCE\(calls\.agent_answer_time,\s*\$8\)/);
  });
  it('L1: syncActiveCalls never downgrades an answered call', () => {
    expect(src).toMatch(/WHEN calls\.disposition = 'answered' THEN 'answered'/);
  });
  it('L2: finalizers clamp wait_seconds to >= 0 (3 sites)', () => {
    const n = (src.match(/GREATEST\(EXTRACT\(EPOCH FROM \(COALESCE\(agent_answer_time, now\(\)\) - queue_enter_time\)\)::INT, 0\)/g) || []).length;
    expect(n).toBe(3);
  });
});
