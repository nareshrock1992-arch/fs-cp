/**
 * Abandoned-call classification regression tests.
 *
 * Root cause fixed here: the queue/agent abandoned split keyed abandoned_queue on
 * "NOT EXISTS(any agent_history row)", so an abandoned call with a STALE offering
 * row (missed=false) fell through BOTH buckets and vanished from reporting even
 * though calls.abandoned=true.
 *
 * The corrected, exhaustive & mutually-exclusive rule (over abandoned=true):
 *   abandoned_agent = EXISTS(agent_history WHERE missed=true)
 *   abandoned_queue = NOT EXISTS(agent_history WHERE missed=true)
 *   → abandoned_queue + abandoned_agent === abandoned_direct   (INVARIANT)
 *
 * Two layers of protection:
 *  1. SQL-shape guard on the ACTUAL controller queries (prevents the exact
 *     regression — any agent_history existence check used for abandoned
 *     classification must be keyed on missed).
 *  2. Semantic table for the 5 documented cases + the invariant.
 *  3. Source guard that the ghost-reaper finalizes agent_history.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../../..');

// ── Mock the DB pool so we can capture the SQL the controllers actually run ────
const captured = [];
vi.mock('../../../db/pool.js', () => ({
  query: vi.fn(async (sql) => { captured.push(String(sql)); return { rows: [], rowCount: 0 }; }),
  pool: {},
  warmPool: vi.fn(),
}));

const stats   = await import('../../../controllers/statsController.js');
const reports = await import('../../../controllers/reportsController.js');

function mockRes() {
  const res = {};
  res.status  = vi.fn(() => res);
  res.json    = vi.fn(() => res);
  res.send    = vi.fn(() => res);
  res.setHeader = vi.fn(() => res);
  res.type    = vi.fn(() => res);
  return res;
}

beforeEach(() => { captured.length = 0; });

// ── 1. SQL-shape guard on the real controller queries ─────────────────────────
describe('SQL classification shape (real controller queries)', () => {
  it('every agent_history EXISTS/NOT EXISTS used for abandoned classification is keyed on missed', async () => {
    await stats.getDashboardStats(mockReq(), mockRes());
    await stats.getQueueStats(mockReq(), mockRes());
    await reports.queuePerformance(mockReq(), mockRes());
    await reports.exportReport(mockReq({ query: { type: 'queue-performance', format: 'csv' } }), mockRes());
    await reports.getCDRReport(mockReq({ query: { disposition: 'abandoned_queue' } }), mockRes());
    await reports.getCDRReport(mockReq({ query: { disposition: 'abandoned_agent' } }), mockRes());

    const all = captured.join('\n---\n');
    // Find every (NOT )EXISTS( SELECT 1 FROM agent_history ... ) block.
    const re = /(NOT\s+)?EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+agent_history\b[^)]*\)/gi;
    const matches = all.match(re) || [];
    expect(matches.length).toBeGreaterThan(0); // sanity: we captured the queries

    for (const m of matches) {
      expect(m).toMatch(/missed/i);
    }
    // The exact old buggy predicate (bare NOT EXISTS on call_uuid, no missed) must be gone.
    const bare = /NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+agent_history\s+ah\s+WHERE\s+ah\.call_uuid\s*=\s*c\.call_uuid\s*\)/i;
    expect(bare.test(all)).toBe(false);
  });
});

// ── 2. Semantic classification table (mirrors the corrected SQL rule) ─────────
// classify(call.abandoned, agentHistoryRows) → { direct, queue, agent }
function classify(abandoned, history) {
  if (!abandoned) return { direct: 0, queue: 0, agent: 0 };
  const agentMissed = history.some(h => h.missed === true);
  return { direct: 1, agent: agentMissed ? 1 : 0, queue: agentMissed ? 0 : 1 };
}

describe('abandoned classification cases + invariant', () => {
  it('Case G — the exact production bug: abandoned + stale row (missed=false)', () => {
    const r = classify(true, [{ ring_start: 't', ring_end: null, talk_start: null, missed: false }]);
    expect(r).toEqual({ direct: 1, queue: 1, agent: 0 });
  });

  it('Case 1 — queue abandonment with NO agent_history', () => {
    expect(classify(true, [])).toEqual({ direct: 1, queue: 1, agent: 0 });
  });

  it('Case 2 — agent missed call (missed=true)', () => {
    expect(classify(true, [{ missed: true }])).toEqual({ direct: 1, queue: 0, agent: 1 });
  });

  it('Case 3 — stale agent-history row (missed=false, talk_start NULL)', () => {
    expect(classify(true, [{ missed: false, talk_start: null }])).toEqual({ direct: 1, queue: 1, agent: 0 });
  });

  it('Case 4 — answered call is never abandoned', () => {
    expect(classify(false, [{ missed: false, talk_start: 't' }])).toEqual({ direct: 0, queue: 0, agent: 0 });
  });

  it('Case 5 — multiple agent_history rows: any missed=true → agent, else queue', () => {
    expect(classify(true, [{ missed: false }, { missed: true }])).toEqual({ direct: 1, queue: 0, agent: 1 });
    expect(classify(true, [{ missed: false }, { missed: false }])).toEqual({ direct: 1, queue: 1, agent: 0 });
  });

  it('INVARIANT — queue + agent === direct for every abandoned shape', () => {
    const shapes = [[], [{ missed: false }], [{ missed: true }], [{ missed: false }, { missed: true }]];
    for (const h of shapes) {
      const r = classify(true, h);
      expect(r.queue + r.agent).toBe(r.direct);
      expect(r.direct).toBe(1);
    }
  });
});

// ── 3. Ghost-reaper consistency guard (source-level) ──────────────────────────
describe('ghost-reaper finalizes agent_history', () => {
  const src = fs.readFileSync(path.join(BACKEND, 'services', 'eslService.js'), 'utf8');
  it('closeGhostCallsEnhanced RETURNs call_uuid and calls finaliseAgentHistoryMissed', () => {
    const fn = src.slice(src.indexOf('async function closeGhostCallsEnhanced'),
                         src.indexOf('async function reaperCycle'));
    expect(fn).toMatch(/RETURNING\s+call_uuid/i);
    expect(fn).toMatch(/finaliseAgentHistoryMissed/);
  });
  it('reaperCycle offline path RETURNs call_uuid and finalizes', () => {
    const fn = src.slice(src.indexOf('async function reaperCycle'),
                         src.indexOf('async function syncActiveCalls'));
    expect(fn).toMatch(/RETURNING\s+call_uuid/i);
    expect(fn).toMatch(/finaliseAgentHistoryMissed/);
  });
});

function mockReq({ query = {}, params = {} } = {}) {
  return { query, params };
}
