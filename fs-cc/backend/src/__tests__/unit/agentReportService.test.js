/**
 * Phase 2 — agentReportService unit tests
 *
 * 14 scenarios (A–N) covering SQL query construction, edge cases, and the
 * calculation layer (occupancy, break aggregates, open-session handling).
 *
 * All DB calls are mocked via vi.mock('../../../db/pool.js').
 * Each test controls the exact rows returned by pool.query so it can assert
 * the correct SQL shape / calculation output without hitting a real database.
 *
 * HOW TO RUN ON DEV SERVER
 * ─────────────────────────
 * cd backend
 * npx vitest run src/__tests__/unit/agentReportService.test.js
 *
 * HOW TO RUN AGAINST REAL DB (integration smoke)
 * ─────────────────────────────────────────────────
 * INTEGRATION=1 npx vitest run src/__tests__/unit/agentReportService.test.js
 * (integration mode is not implemented here — use Postman or curl for that)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock DB pool ──────────────────────────────────────────────────────────────
vi.mock('../../../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../../db/pool.js';
import {
  getSessionsSummary,
  getSessionsList,
  getStateEventsList,
  getStateDurations,
  getCallMetrics,
  getBreakList,
  getActivityDetail,
  getActivitySummary,
} from '../../../services/agentReportService.js';

// Helpers
const FROM = new Date('2026-06-01T00:00:00Z');
const TO   = new Date('2026-06-30T23:59:59Z');
const AGENT = 'agent_001';

function mockQuery(...rowSets) {
  let call = 0;
  query.mockImplementation(() =>
    Promise.resolve({ rows: rowSets[call++] ?? [] })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario A — getSessionsSummary: all agents, returns aggregated rows
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario A — getSessionsSummary (all agents)', () => {
  it('returns one row per agent with correct shape', async () => {
    const mockRows = [
      {
        agent_id: 'agent_001', full_name: 'Alice', session_count: 3,
        first_login: FROM, last_activity: TO,
        total_login_seconds: 28800, has_open_session: false,
      },
    ];
    mockQuery(mockRows);

    const result = await getSessionsSummary(FROM, TO, null);

    expect(result).toHaveLength(1);
    expect(result[0].agent_id).toBe('agent_001');
    expect(result[0].session_count).toBe(3);
    expect(result[0].total_login_seconds).toBe(28800);

    // Verify query was called with [FROM, TO] (no agent_id param)
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([FROM, TO]);
    expect(sql).not.toContain('$3');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario B — getSessionsSummary: single agent filter adds $3 param
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario B — getSessionsSummary (single agent filter)', () => {
  it('passes agentId as $3 and includes it in WHERE clause', async () => {
    mockQuery([
      {
        agent_id: AGENT, full_name: 'Alice', session_count: 2,
        first_login: FROM, last_activity: TO,
        total_login_seconds: 14400, has_open_session: false,
      },
    ]);

    const result = await getSessionsSummary(FROM, TO, AGENT);

    expect(result[0].agent_id).toBe(AGENT);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([FROM, TO, AGENT]);
    expect(sql).toContain('$3');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario C — getSessionsSummary: empty result (agent never logged in)
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario C — getSessionsSummary (no data)', () => {
  it('returns empty array when agent has no sessions in range', async () => {
    mockQuery([]);
    const result = await getSessionsSummary(FROM, TO, 'agent_999');
    expect(result).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario D — getSessionsList: open session has is_open=true
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario D — getSessionsList (open session)', () => {
  it('returns is_open=true and is_live=true for open sessions', async () => {
    mockQuery([
      {
        id: 42, agent_id: AGENT, login_at: FROM, logout_at: null,
        logout_reason: null, duration_seconds: 3600,
        is_open: true, is_live: true,
      },
    ]);

    const result = await getSessionsList(AGENT, FROM, TO);

    expect(result).toHaveLength(1);
    expect(result[0].is_open).toBe(true);
    expect(result[0].is_live).toBe(true);
    expect(result[0].logout_at).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario E — getStateDurations: returns separate rows for Available / On Break
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario E — getStateDurations (both statuses)', () => {
  it('returns two rows (Available and On Break) with correct aggregates', async () => {
    mockQuery([
      {
        agent_id: AGENT, full_name: 'Alice', status: 'Available',
        segment_count: 5, total_seconds: 25000,
        max_segment_seconds: 8000, avg_segment_seconds: 5000,
      },
      {
        agent_id: AGENT, full_name: 'Alice', status: 'On Break',
        segment_count: 2, total_seconds: 2400,
        max_segment_seconds: 1500, avg_segment_seconds: 1200,
      },
    ]);

    const result = await getStateDurations(FROM, TO, AGENT);

    expect(result).toHaveLength(2);
    const avail = result.find(r => r.status === 'Available');
    const brk   = result.find(r => r.status === 'On Break');

    expect(avail.total_seconds).toBe(25000);
    expect(brk.segment_count).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario F — getCallMetrics: correct aggregation shape
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario F — getCallMetrics', () => {
  it('returns call counts and durations with correct field names', async () => {
    mockQuery([
      {
        agent_id: AGENT, full_name: 'Alice',
        calls_offered: 40, calls_answered: 35, calls_missed: 5,
        total_ring_seconds: 800, total_talk_seconds: 14000,
        avg_talk_seconds: 400, max_talk_seconds: 1800, min_talk_seconds: 30,
      },
    ]);

    const result = await getCallMetrics(FROM, TO, AGENT);

    expect(result[0].calls_offered).toBe(40);
    expect(result[0].calls_answered).toBe(35);
    expect(result[0].calls_missed).toBe(5);
    expect(result[0].total_talk_seconds).toBe(14000);
    // Must NOT have a field named aht or average_handle_time
    expect(result[0]).not.toHaveProperty('aht');
    expect(result[0]).not.toHaveProperty('average_handle_time');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario G — getActivityDetail: occupancy_pct calculated correctly
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario G — getActivityDetail occupancy calculation', () => {
  it('computes occupancy_pct as (ring+talk)/available*100', async () => {
    // getActivityDetail calls 4 sub-functions in parallel
    // Order: getSessionsSummary, getStateDurations, getCallMetrics, getBreakList
    query
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', session_count: 1,
          first_login: FROM, last_activity: TO,
          total_login_seconds: 28800, has_open_session: false },
      ]})
      // stateDurations — Available 10000s, On Break 1200s
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', status: 'Available',
          segment_count: 3, total_seconds: 10000,
          max_segment_seconds: 5000, avg_segment_seconds: 3333 },
        { agent_id: AGENT, full_name: 'Alice', status: 'On Break',
          segment_count: 1, total_seconds: 1200,
          max_segment_seconds: 1200, avg_segment_seconds: 1200 },
      ]})
      // callMetrics — ring 500s, talk 2500s → engaged 3000s
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice',
          calls_offered: 10, calls_answered: 9, calls_missed: 1,
          total_ring_seconds: 500, total_talk_seconds: 2500,
          avg_talk_seconds: 278, max_talk_seconds: 600, min_talk_seconds: 60 },
      ]})
      // breakList — empty (no individual break rows needed for this test)
      .mockResolvedValueOnce({ rows: [] });

    const detail = await getActivityDetail(AGENT, FROM, TO);

    // occupancy = (500 + 2500) / 10000 * 100 = 30.0
    expect(detail.occupancy.pct).toBe(30.0);
    expect(detail.occupancy.available_seconds).toBe(10000);
    expect(detail.occupancy.engaged_seconds).toBe(3000);
    expect(detail.occupancy.ring_seconds).toBe(500);
    expect(detail.occupancy.talk_seconds).toBe(2500);
    expect(detail.occupancy.formula).toMatch(/ring_seconds \+ talk_seconds/);
    expect(detail.occupancy.null_reason).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario H — getActivityDetail: occupancy NULL when available_seconds = 0
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario H — getActivityDetail occupancy NULL (zero denominator)', () => {
  it('sets occupancy.pct=null and populates null_reason', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })  // no sessions
      .mockResolvedValueOnce({ rows: [] })  // no state events (available=0)
      .mockResolvedValueOnce({ rows: [] })  // no call metrics
      .mockResolvedValueOnce({ rows: [] }); // no breaks

    const detail = await getActivityDetail('agent_new', FROM, TO);

    expect(detail.occupancy.pct).toBeNull();
    expect(detail.occupancy.null_reason).toMatch(/available_seconds is 0/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario I — getActivityDetail: open session emits warning
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario I — getActivityDetail open session warning', () => {
  it('includes open_session warning in open_warnings array', async () => {
    query
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', session_count: 1,
          first_login: FROM, last_activity: new Date(),
          total_login_seconds: 3600, has_open_session: true },  // <-- open
      ]})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const detail = await getActivityDetail(AGENT, FROM, TO);

    expect(detail.open_warnings).toHaveLength(1);
    expect(detail.open_warnings[0]).toMatch(/open session/i);
    expect(detail.sessions.has_open_session).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario J — getActivityDetail: open break emits second warning
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario J — getActivityDetail open break warning', () => {
  it('includes break warning when an open break exists', async () => {
    query
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', session_count: 1,
          first_login: FROM, last_activity: new Date(),
          total_login_seconds: 3600, has_open_session: false },
      ]})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      // Open break
      .mockResolvedValueOnce({ rows: [
        { id: 99, break_start: new Date(), break_end: null,
          duration_seconds: 300, source: 'fs_event', is_open: true },
      ]});

    const detail = await getActivityDetail(AGENT, FROM, TO);

    const breakWarnings = detail.open_warnings.filter(w => /break/i.test(w));
    expect(breakWarnings.length).toBeGreaterThanOrEqual(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario K — getActivityDetail: break aggregates computed correctly
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario K — getActivityDetail break aggregates', () => {
  it('computes total, avg, and longest break from individual rows', async () => {
    const breakRows = [
      { id: 1, break_start: new Date(), break_end: new Date(), duration_seconds: 600,  source: 'fs_event', is_open: false },
      { id: 2, break_start: new Date(), break_end: new Date(), duration_seconds: 1200, source: 'agent_self', is_open: false },
      { id: 3, break_start: new Date(), break_end: new Date(), duration_seconds: 300,  source: 'fs_event', is_open: false },
    ];

    query
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', session_count: 1,
          first_login: FROM, last_activity: TO,
          total_login_seconds: 28800, has_open_session: false },
      ]})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: breakRows });

    const detail = await getActivityDetail(AGENT, FROM, TO);

    expect(detail.breaks.count).toBe(3);
    expect(detail.breaks.total_seconds).toBe(2100);        // 600+1200+300
    expect(detail.breaks.longest_seconds).toBe(1200);
    expect(detail.breaks.avg_seconds).toBe(700);           // 2100/3
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario L — getActivitySummary: joins three data sources by agent_id
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario L — getActivitySummary agent join', () => {
  it('correctly merges session + state + call rows for each agent', async () => {
    // getActivitySummary calls: getSessionsSummary, getStateDurations, getCallMetrics
    query
      // sessionsSummary
      .mockResolvedValueOnce({ rows: [
        { agent_id: 'a1', full_name: 'Alice', session_count: 2,
          first_login: FROM, last_activity: TO,
          total_login_seconds: 57600, has_open_session: false },
        { agent_id: 'a2', full_name: 'Bob', session_count: 1,
          first_login: FROM, last_activity: TO,
          total_login_seconds: 28800, has_open_session: false },
      ]})
      // stateDurations
      .mockResolvedValueOnce({ rows: [
        { agent_id: 'a1', full_name: 'Alice', status: 'Available',
          segment_count: 4, total_seconds: 50000,
          max_segment_seconds: 20000, avg_segment_seconds: 12500 },
        { agent_id: 'a2', full_name: 'Bob', status: 'Available',
          segment_count: 2, total_seconds: 25000,
          max_segment_seconds: 15000, avg_segment_seconds: 12500 },
      ]})
      // callMetrics
      .mockResolvedValueOnce({ rows: [
        { agent_id: 'a1', full_name: 'Alice',
          calls_offered: 30, calls_answered: 28, calls_missed: 2,
          total_ring_seconds: 600, total_talk_seconds: 10000,
          avg_talk_seconds: 357, max_talk_seconds: 900, min_talk_seconds: 60 },
        { agent_id: 'a2', full_name: 'Bob',
          calls_offered: 20, calls_answered: 18, calls_missed: 2,
          total_ring_seconds: 400, total_talk_seconds: 7000,
          avg_talk_seconds: 389, max_talk_seconds: 800, min_talk_seconds: 60 },
      ]});

    const result = await getActivitySummary(FROM, TO);

    expect(result).toHaveLength(2);

    const alice = result.find(r => r.agent_id === 'a1');
    const bob   = result.find(r => r.agent_id === 'a2');

    expect(alice.available_seconds).toBe(50000);
    expect(alice.calls_answered).toBe(28);
    // occupancy: (600+10000)/50000*100 = 21.2
    expect(alice.occupancy_pct).toBe(21.2);

    expect(bob.total_login_seconds).toBe(28800);
    expect(bob.calls_missed).toBe(2);
    // occupancy: (400+7000)/25000*100 = 29.6
    expect(bob.occupancy_pct).toBe(29.6);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario M — getActivitySummary: agent with only call data (no sessions)
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario M — getActivitySummary agent in call data but not session data', () => {
  it('includes agent with defaults for missing session and state data', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })   // no sessions
      .mockResolvedValueOnce({ rows: [] })   // no state events
      .mockResolvedValueOnce({ rows: [
        { agent_id: 'ghost', full_name: 'Ghost Agent',
          calls_offered: 5, calls_answered: 5, calls_missed: 0,
          total_ring_seconds: 100, total_talk_seconds: 2000,
          avg_talk_seconds: 400, max_talk_seconds: 600, min_talk_seconds: 200 },
      ]});

    const result = await getActivitySummary(FROM, TO);

    expect(result).toHaveLength(1);
    expect(result[0].agent_id).toBe('ghost');
    expect(result[0].session_count).toBe(0);
    expect(result[0].available_seconds).toBe(0);
    expect(result[0].occupancy_pct).toBeNull();  // available=0 → NULL
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario N — utcDateRange interpretation (controller level)
// Testing the date range helper logic via direct import of the controller
// module is complex (it's not exported), so this test validates the behavior
// through the service calls it makes.
//
// We verify that when from/to are Date objects, the SQL params receive them
// correctly without timezone mutation.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario N — UTC date param pass-through', () => {
  it('passes Date objects through to SQL params unchanged', async () => {
    const from = new Date('2026-08-01T00:00:00Z');
    const to   = new Date('2026-08-01T23:59:59Z');

    mockQuery([]);

    await getSessionsSummary(from, to, null);

    const [, params] = query.mock.calls[0];
    expect(params[0]).toBe(from);  // exact same Date object reference
    expect(params[1]).toBe(to);
    // Confirm UTC midnight is preserved (not shifted to local time)
    expect(params[0].toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(params[1].toISOString()).toBe('2026-08-01T23:59:59.000Z');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario O — getActivityDetail: agent with no data in any table
// All four parallel queries return empty results. Verifies no crash and that
// all fields default to safe zero/null values.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario O — getActivityDetail: agent absent from all tables', () => {
  it('returns zero/null defaults without crashing', async () => {
    // All four parallel queries return empty: getSessionsSummary, getStateDurations,
    // getCallMetrics, getBreakList
    mockQuery(
      [],   // sessSum → []
      [],   // stateDur → []
      [],   // callMet → []
      [],   // breakList → []
    );

    const result = await getActivityDetail('nobody', FROM, TO);

    expect(result.agent_id).toBe('nobody');
    expect(result.full_name).toBeNull();

    // Sessions: all zero defaults
    expect(result.sessions.count).toBe(0);
    expect(result.sessions.first_login).toBeNull();
    expect(result.sessions.total_login_seconds).toBe(0);
    expect(result.sessions.has_open_session).toBe(false);

    // State durations: all zero
    expect(result.state_durations.available_seconds).toBe(0);
    expect(result.state_durations.break_seconds).toBe(0);
    expect(result.state_durations.break_count).toBe(0);

    // Call metrics: all zero
    expect(result.call_metrics.calls_offered).toBe(0);
    expect(result.call_metrics.calls_answered).toBe(0);
    expect(result.call_metrics.calls_missed).toBe(0);
    expect(result.call_metrics.avg_talk_seconds).toBe(0);

    // Occupancy: null (available_seconds = 0)
    expect(result.occupancy.pct).toBeNull();
    expect(result.occupancy.null_reason).not.toBeNull();

    // Breaks: all zero
    expect(result.breaks.count).toBe(0);
    expect(result.breaks.total_seconds).toBe(0);
    expect(result.breaks.longest_seconds).toBe(0);

    // No open warnings (no session, no breaks)
    expect(result.open_warnings).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario P — getActivitySummary: agent appears only in call metrics
// Verifies JS union logic: agent_id is picked up from callMap even when
// sessMap and stateMap have no entry for it.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario P — getActivitySummary: agent only in call metrics', () => {
  it('includes agent and sets session/state defaults to zero, occupancy to null', async () => {
    // Three parallel queries: getSessionsSummary, getStateDurations, getCallMetrics
    mockQuery(
      [],   // sessSum → no sessions for this agent
      [],   // stateDur → no state events
      [{
        agent_id: 'call_only', full_name: 'Call Only Agent',
        calls_offered: 3, calls_answered: 2, calls_missed: 1,
        total_ring_seconds: 60, total_talk_seconds: 300,
        avg_talk_seconds: 150, max_talk_seconds: 200, min_talk_seconds: 100,
      }],
    );

    const result = await getActivitySummary(FROM, TO);

    expect(result).toHaveLength(1);
    const row = result[0];

    expect(row.agent_id).toBe('call_only');
    expect(row.full_name).toBe('Call Only Agent');

    // Session defaults
    expect(row.session_count).toBe(0);
    expect(row.total_login_seconds).toBe(0);
    expect(row.has_open_session).toBe(false);

    // State defaults
    expect(row.available_seconds).toBe(0);
    expect(row.break_seconds).toBe(0);

    // Call metrics preserved
    expect(row.calls_offered).toBe(3);
    expect(row.calls_answered).toBe(2);
    expect(row.calls_missed).toBe(1);
    expect(row.total_ring_seconds).toBe(60);
    expect(row.total_talk_seconds).toBe(300);
    expect(row.avg_talk_seconds).toBe(150);

    // Occupancy null: available_seconds = 0
    expect(row.occupancy_pct).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario Q — getActivityDetail: missed-calls-only (no answered calls)
// Agent received calls but none were answered; talk_seconds = 0.
// Occupancy formula uses ring+talk — ring-only still counts as engaged.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario Q — getActivityDetail: missed-calls-only agent', () => {
  it('sets calls_missed and uses ring time in occupancy without crashing', async () => {
    query
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', session_count: 1,
          first_login: FROM, last_activity: TO,
          total_login_seconds: 3600, has_open_session: false },
      ]})
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', status: 'Available',
          segment_count: 1, total_seconds: 3600,
          max_segment_seconds: 3600, avg_segment_seconds: 3600 },
      ]})
      // All 5 calls missed — talk = 0
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice',
          calls_offered: 5, calls_answered: 0, calls_missed: 5,
          total_ring_seconds: 150, total_talk_seconds: 0,
          avg_talk_seconds: 0, max_talk_seconds: 0, min_talk_seconds: 0 },
      ]})
      .mockResolvedValueOnce({ rows: [] });

    const detail = await getActivityDetail(AGENT, FROM, TO);

    expect(detail.call_metrics.calls_answered).toBe(0);
    expect(detail.call_metrics.calls_missed).toBe(5);
    expect(detail.call_metrics.total_talk_seconds).toBe(0);

    // occupancy = (150 + 0) / 3600 * 100 = 4.166…
    expect(detail.occupancy.pct).toBeCloseTo(4.17, 1);
    expect(detail.occupancy.null_reason).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario R — getActivityDetail: answered call with zero talk duration
// Could occur when a call is answered and immediately abandoned or when
// the CDR has a race (talk_seconds rounds to 0).
// avg_talk_seconds = 0 must not produce NaN or crash.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario R — getActivityDetail: zero-talk answered call', () => {
  it('returns avg_talk_seconds=0 and computes occupancy from ring only', async () => {
    query
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', session_count: 1,
          first_login: FROM, last_activity: TO,
          total_login_seconds: 1800, has_open_session: false },
      ]})
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', status: 'Available',
          segment_count: 1, total_seconds: 1800,
          max_segment_seconds: 1800, avg_segment_seconds: 1800 },
      ]})
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice',
          calls_offered: 1, calls_answered: 1, calls_missed: 0,
          total_ring_seconds: 20, total_talk_seconds: 0,
          avg_talk_seconds: 0, max_talk_seconds: 0, min_talk_seconds: 0 },
      ]})
      .mockResolvedValueOnce({ rows: [] });

    const detail = await getActivityDetail(AGENT, FROM, TO);

    expect(detail.call_metrics.calls_answered).toBe(1);
    expect(detail.call_metrics.avg_talk_seconds).toBe(0);

    // occupancy = (20 + 0) / 1800 * 100 = 1.11…
    expect(detail.occupancy.pct).toBeCloseTo(1.11, 1);
    expect(detail.occupancy.null_reason).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario S — getActivityDetail: occupancy exactly 100%
// Agent was on ring or talk for the entire available window.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario S — getActivityDetail: occupancy = 100%', () => {
  it('computes occupancy.pct = 100 when engaged_seconds = available_seconds', async () => {
    query
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', session_count: 1,
          first_login: FROM, last_activity: TO,
          total_login_seconds: 5000, has_open_session: false },
      ]})
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', status: 'Available',
          segment_count: 1, total_seconds: 5000,
          max_segment_seconds: 5000, avg_segment_seconds: 5000 },
      ]})
      // ring 1000 + talk 4000 = 5000 = available → 100%
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice',
          calls_offered: 8, calls_answered: 8, calls_missed: 0,
          total_ring_seconds: 1000, total_talk_seconds: 4000,
          avg_talk_seconds: 500, max_talk_seconds: 800, min_talk_seconds: 200 },
      ]})
      .mockResolvedValueOnce({ rows: [] });

    const detail = await getActivityDetail(AGENT, FROM, TO);

    expect(detail.occupancy.pct).toBe(100);
    expect(detail.occupancy.null_reason).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario T — getActivityDetail: occupancy > 100% (clock-drift anomaly)
// Can occur when FreeSWITCH CDR timestamps are slightly inconsistent.
// The service must not cap or reject this — report the raw value so the
// UI can flag it rather than silently truncating.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario T — getActivityDetail: occupancy > 100% (anomaly)', () => {
  it('returns occupancy.pct > 100 without capping or throwing', async () => {
    query
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', session_count: 1,
          first_login: FROM, last_activity: TO,
          total_login_seconds: 3000, has_open_session: false },
      ]})
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice', status: 'Available',
          segment_count: 1, total_seconds: 1000,
          max_segment_seconds: 1000, avg_segment_seconds: 1000 },
      ]})
      // ring 200 + talk 900 = 1100 > available 1000 → 110%
      .mockResolvedValueOnce({ rows: [
        { agent_id: AGENT, full_name: 'Alice',
          calls_offered: 4, calls_answered: 4, calls_missed: 0,
          total_ring_seconds: 200, total_talk_seconds: 900,
          avg_talk_seconds: 225, max_talk_seconds: 350, min_talk_seconds: 100 },
      ]})
      .mockResolvedValueOnce({ rows: [] });

    const detail = await getActivityDetail(AGENT, FROM, TO);

    expect(detail.occupancy.pct).toBeCloseTo(110, 0);
    expect(detail.occupancy.null_reason).toBeNull();
  });
});
