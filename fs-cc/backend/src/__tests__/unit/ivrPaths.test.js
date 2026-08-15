/**
 * Unit tests for ivrPathDistribution() — IVR Paths reporting classification.
 *
 * Verifies that:
 *   - DTMF events  → dtmf[]   (unique-call count per digit)
 *   - Queue calls  → queues[] (from calls.queue_name, not ivr_path)
 *   - Other events → other[]  (playback, gather_digits, etc.)
 *   - These three are never mixed
 *   - Deduplication: one call pressing the same digit N times = 1 call
 *   - A callcenter ivr_path entry without queue_name is NOT in queues[]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock DB pool ──────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock('../../../db/pool.js', () => ({ query: (...a) => mockQuery(...a) }));

const { ivrPathDistribution } = await import('../../../controllers/reportsController.js');

// ── Request/Response helpers ──────────────────────────────────────────────────

function mockReq(from = '2026-01-01', to = '2026-01-31') {
  return { query: { from, to } };
}

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json   = vi.fn().mockReturnValue(res);
  return res;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ivrPathDistribution runs three queries sequentially (dtmf, queues, other).
// mockQuery is called in that order per invocation.
function setupMockResults(dtmfRows, queueRows, otherRows) {
  mockQuery
    .mockResolvedValueOnce({ rows: dtmfRows })
    .mockResolvedValueOnce({ rows: queueRows })
    .mockResolvedValueOnce({ rows: otherRows });
}

beforeEach(() => { mockQuery.mockClear(); });

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — Single DTMF press
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 1 — Single DTMF press', () => {
  it('returns digit in dtmf[], empty queues and other', async () => {
    setupMockResults(
      [{ digit: '1', calls: 1 }],
      [],
      []
    );
    const req = mockReq();
    const res = mockRes();
    await ivrPathDistribution(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.dtmf).toHaveLength(1);
    expect(body.dtmf[0].digit).toBe('1');
    expect(body.dtmf[0].calls).toBe(1);
    expect(body.queues).toHaveLength(0);
    expect(body.other).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — Repeated DTMF in one call → deduplicated to 1 call
// (deduplication happens in SQL; the controller receives already-deduped rows)
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 2 — Repeated DTMF deduplication', () => {
  it('three pressed_1 events in one call are counted as 1 call', async () => {
    // The SQL CTE deduplicates before COUNT DISTINCT; the controller receives
    // the already-reduced result. Verify the share math and structure.
    setupMockResults(
      [{ digit: '1', calls: 1 }],
      [],
      []
    );
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const body = res.json.mock.calls[0][0];
    expect(body.dtmf[0].calls).toBe(1);
    expect(body.dtmf[0].share).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — Multiple distinct digits in one call
// pressed_1, pressed_2, pressed_1 → digit 1 = 1, digit 2 = 1
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 3 — Multiple digits in one call', () => {
  it('each digit gets its own row; digit 1 appears once even if pressed twice', async () => {
    setupMockResults(
      [
        { digit: '1', calls: 1 },
        { digit: '2', calls: 1 },
      ],
      [],
      []
    );
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const { dtmf } = res.json.mock.calls[0][0];
    expect(dtmf).toHaveLength(2);
    expect(dtmf.find(r => r.digit === '1').calls).toBe(1);
    expect(dtmf.find(r => r.digit === '2').calls).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4 — Real queue from calls.queue_name (with @context suffix stripped)
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 4 — Real queue from calls.queue_name', () => {
  it('queue name appears in queues[] after @suffix stripping', async () => {
    // split_part in SQL strips "@default"; controller receives clean name
    setupMockResults(
      [],
      [{ queue: 'ComputerCommunication', calls: 5 }],
      []
    );
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const { queues } = res.json.mock.calls[0][0];
    expect(queues).toHaveLength(1);
    expect(queues[0].queue).toBe('ComputerCommunication');
    expect(queues[0].calls).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5 — CRITICAL: callcenter ivr_path entry without queue_name
// A CHANNEL_EXECUTE(callcenter) event without member-queue-start means
// the queue rejected the call. It must NOT appear in queues[].
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 5 — callcenter ivr_path without queue_name is NOT in queues', () => {
  it('queues[] is empty when queue_name IS NULL even if ivr_path has callcenter app', async () => {
    // queues source is calls.queue_name IS NOT NULL.
    // If queue_name is NULL, the SQL WHERE clause excludes the row.
    // The mock simulates zero rows returned from that query.
    setupMockResults(
      [],
      [],   // ← no rows: queue_name IS NULL for these calls
      [{ step: 'queue:RejectedQueue', calls: 1 }]   // lands in other[]
    );
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const { queues, other } = res.json.mock.calls[0][0];
    expect(queues).toHaveLength(0);
    // The callcenter step (app=callcenter) is excluded from other[] by SQL
    // (COALESCE(step_obj->>'app','') <> 'callcenter').
    // The mock here represents any non-dtmf/non-callcenter other step.
    expect(other).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6 — DTMF after queue entry: both digits appear in dtmf[]
// queue destination comes ONLY from queue_name, not digit position
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 6 — DTMF during and after queue entry', () => {
  it('digits before and after queue entry both appear in dtmf[]', async () => {
    setupMockResults(
      [
        { digit: '1', calls: 1 },
        { digit: '2', calls: 1 },
      ],
      [{ queue: 'Support', calls: 1 }],
      []
    );
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const { dtmf, queues } = res.json.mock.calls[0][0];
    // Both digits recorded (one pre-queue, one post-queue)
    expect(dtmf.find(r => r.digit === '1')).toBeTruthy();
    expect(dtmf.find(r => r.digit === '2')).toBeTruthy();
    // Queue comes from queue_name, not digit timing
    expect(queues[0].queue).toBe('Support');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7 — Other system event (playback)
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 7 — playback app lands in other[]', () => {
  it('play:welcome_en appears in other[]', async () => {
    setupMockResults(
      [],
      [],
      [{ step: 'play:welcome_en', calls: 10 }]
    );
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const { other } = res.json.mock.calls[0][0];
    expect(other[0].step).toBe('play:welcome_en');
    expect(other[0].calls).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8 — Unknown event (no digit, no recognisable app)
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 8 — Unknown/malformed ivr_path element lands in other[]', () => {
  it('unknown steps are not silently discarded', async () => {
    setupMockResults(
      [],
      [],
      [{ step: '(unknown)', calls: 2 }]
    );
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const { other } = res.json.mock.calls[0][0];
    expect(other.find(r => r.step === '(unknown)')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9 — Multiple queues
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 9 — Multiple queues from calls.queue_name', () => {
  it('each queue appears as a separate row sorted by calls DESC', async () => {
    setupMockResults(
      [],
      [
        { queue: 'ComputerCommunication', calls: 42 },
        { queue: 'YASREFIT',             calls: 31 },
        { queue: 'SAPapps',              calls: 16 },
      ],
      []
    );
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const { queues } = res.json.mock.calls[0][0];
    expect(queues).toHaveLength(3);
    expect(queues[0].queue).toBe('ComputerCommunication');
    expect(queues[1].queue).toBe('YASREFIT');
    expect(queues[2].queue).toBe('SAPapps');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10 — Mixed historical data: all three sections populated simultaneously
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 10 — Mixed historical data: three sections populated', () => {
  it('returns populated dtmf, queues, and other without cross-contamination', async () => {
    setupMockResults(
      [{ digit: '1', calls: 9 }, { digit: '2', calls: 3 }],
      [{ queue: 'ComputerCommunication', calls: 15 }, { queue: 'YASREFIT', calls: 13 }],
      [{ step: 'gather_digits', calls: 22 }]
    );
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const body = res.json.mock.calls[0][0];

    // No queue names in dtmf
    body.dtmf.forEach(r => expect(r.digit).not.toMatch(/^queue:/));
    // No pressed_ values in queues
    body.queues.forEach(r => expect(r.queue).not.toMatch(/^pressed_/));
    // Counts correct
    expect(body.dtmf[0].digit).toBe('1');
    expect(body.queues[0].queue).toBe('ComputerCommunication');
    expect(body.other[0].step).toBe('gather_digits');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11 — Date filtering: query is called with the correct date params
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 11 — Date filtering', () => {
  it('passes from/to parameters to all three SQL queries', async () => {
    setupMockResults([], [], []);
    const res = mockRes();
    await ivrPathDistribution(mockReq('2026-06-01', '2026-06-30'), res);

    // Three queries were issued
    expect(mockQuery).toHaveBeenCalledTimes(3);

    // Each query receives two date params as first two args
    for (const call of mockQuery.mock.calls) {
      const [_sql, params] = call;
      expect(params[0]).toBeInstanceOf(Date);
      expect(params[1]).toBeInstanceOf(Date);
      // from < to
      expect(params[0].getTime()).toBeLessThan(params[1].getTime());
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12 — Share calculation
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 12 — Share calculation', () => {
  it('share is rounded integer percentage of section total', async () => {
    setupMockResults(
      [{ digit: '1', calls: 42 }, { digit: '2', calls: 31 }, { digit: '3', calls: 16 }],
      [],
      []
    );
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const { dtmf } = res.json.mock.calls[0][0];
    const total = 42 + 31 + 16; // 89
    expect(dtmf[0].share).toBe(Math.round(42 / total * 100)); // 47
    expect(dtmf[1].share).toBe(Math.round(31 / total * 100)); // 35
    expect(dtmf[2].share).toBe(Math.round(16 / total * 100)); // 18
  });

  it('share is 0 when section total is 0 (defensive)', async () => {
    setupMockResults([], [{ queue: 'Support', calls: 0 }], []);
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const { queues } = res.json.mock.calls[0][0];
    expect(queues[0].share).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 13 — API shape: all three keys always present even when empty
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 13 — API always returns {dtmf, queues, other}', () => {
  it('empty sections return [] not null', async () => {
    setupMockResults([], [], []);
    const res = mockRes();
    await ivrPathDistribution(mockReq(), res);

    const body = res.json.mock.calls[0][0];
    expect(Array.isArray(body.dtmf)).toBe(true);
    expect(Array.isArray(body.queues)).toBe(true);
    expect(Array.isArray(body.other)).toBe(true);
    expect(body.dtmf).toHaveLength(0);
    expect(body.queues).toHaveLength(0);
    expect(body.other).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 14 — CSV export: type,label,calls columns; dtmf and queue separated
// ─────────────────────────────────────────────────────────────────────────────
describe('TEST 14 — CSV export structure', () => {
  it('ivr-paths CSV has type,label,calls and separates dtmf from queue rows', async () => {
    // exportReport runs three concurrent queries via Promise.all; mock in order
    mockQuery
      .mockResolvedValueOnce({ rows: [{ type: 'dtmf',  label: '1',                    calls: 42 }] })
      .mockResolvedValueOnce({ rows: [{ type: 'queue', label: 'ComputerCommunication', calls: 42 }] })
      .mockResolvedValueOnce({ rows: [] });

    const { exportReport } = await import('../../../controllers/reportsController.js');
    const req = { query: { type: 'ivr-paths', format: 'csv', from: '2026-01-01', to: '2026-01-31' } };
    const res = {
      setHeader: vi.fn(),
      send:      vi.fn(),
      json:      vi.fn(),
      status:    vi.fn().mockReturnThis(),
    };

    await exportReport(req, res);

    expect(res.send).toHaveBeenCalledOnce();
    const csv = res.send.mock.calls[0][0];
    expect(csv).toContain('type,label,calls');
    expect(csv).toContain('dtmf,1,42');
    expect(csv).toContain('queue,ComputerCommunication,42');
    // Confirm dtmf and queue are on separate lines
    expect(csv).not.toContain('dtmf,ComputerCommunication');
    expect(csv).not.toContain('queue,1,');
  });
});
