/**
 * Phase 4 — agentReportController unit tests
 *
 * Covers the HTTP handler layer: utcDateRange validation (scenarios 1–3)
 * and the activitySummary branching logic (scenario 6).
 *
 * The service layer is fully mocked — no DB calls occur.
 *
 * HOW TO RUN
 * ──────────
 * cd backend
 * npx vitest run src/__tests__/unit/agentReportController.test.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the service so controller tests stay unit-level ──────────────────────
vi.mock('../../../services/agentReportService.js', () => ({
  getSessionsSummary:  vi.fn(),
  getSessionsList:     vi.fn(),
  getStateDurations:   vi.fn(),
  getStateEventsList:  vi.fn(),
  getCallMetrics:      vi.fn(),
  getBreakList:        vi.fn(),
  getActivityDetail:   vi.fn(),
  getActivitySummary:  vi.fn(),
}));

import * as svc from '../../../services/agentReportService.js';
import {
  sessionsSummary,
  activitySummary,
  activityDetail,
  stateEventsList,
} from '../../../controllers/agentReportController.js';

// ── Mock req/res factory ──────────────────────────────────────────────────────

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);  // enable chaining: res.status(400).json(...)
  return res;
}

function mockReq({ query = {}, params = {} } = {}) {
  return { query, params };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 1 — utcDateRange: bare from date, to omitted (defaults to today)
// Verifies that missing `to` is silently defaulted and the service is called.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario 1 — utcDateRange: to omitted (uses today as default)', () => {
  it('calls the service without error when `to` is absent', async () => {
    svc.getSessionsSummary.mockResolvedValue([]);

    const req = mockReq({ query: { from: '2026-06-01' } });
    const res = mockRes();

    await sessionsSummary(req, res);

    // Should NOT send a 400 — default to today
    expect(res.status).not.toHaveBeenCalledWith(400);

    // Service was called with a valid Date pair
    expect(svc.getSessionsSummary).toHaveBeenCalledOnce();
    const [fromArg, toArg] = svc.getSessionsSummary.mock.calls[0];
    expect(fromArg).toBeInstanceOf(Date);
    expect(toArg).toBeInstanceOf(Date);

    // from must be 2026-06-01T00:00:00Z
    expect(fromArg.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    // to must be today's date (just verify it's a valid future-ish Date)
    expect(isNaN(toArg.getTime())).toBe(false);
    expect(toArg >= fromArg).toBe(true);

    // Response was sent
    expect(res.json).toHaveBeenCalledOnce();
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty('date_range');
    expect(body).toHaveProperty('agents');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 2 — utcDateRange: malformed `from` date
// Controller must return 400 and NOT call the service.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario 2 — utcDateRange: malformed from date', () => {
  it('returns 400 and skips the service call', async () => {
    const req = mockReq({ query: { from: 'invalid-date', to: '2026-06-30' } });
    const res = mockRes();

    await sessionsSummary(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('ISO-8601') })
    );
    expect(svc.getSessionsSummary).not.toHaveBeenCalled();
  });

  it('also rejects a malformed to date', async () => {
    const req = mockReq({ query: { from: '2026-06-01', to: 'not-a-date' } });
    const res = mockRes();

    await sessionsSummary(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(svc.getSessionsSummary).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 3 — utcDateRange: from > to (reversed range)
// Controller must return 400 and NOT call the service.
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario 3 — utcDateRange: reversed range (from > to)', () => {
  it('returns 400 with a descriptive error', async () => {
    const req = mockReq({ query: { from: '2026-06-30', to: '2026-06-01' } });
    const res = mockRes();

    await sessionsSummary(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/from.*before|before.*to/i) })
    );
    expect(svc.getSessionsSummary).not.toHaveBeenCalled();
  });

  it('allows from === to (same-day range is valid)', async () => {
    svc.getSessionsSummary.mockResolvedValue([]);

    const req = mockReq({ query: { from: '2026-06-15', to: '2026-06-15' } });
    const res = mockRes();

    await sessionsSummary(req, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(svc.getSessionsSummary).toHaveBeenCalledOnce();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Scenario 6 — activitySummary: branching on agent_id query param
//
// Without agent_id  → calls svc.getActivitySummary()
// With    agent_id  → calls svc.getActivityDetail() and flattens to one-row array
// ═════════════════════════════════════════════════════════════════════════════
describe('Scenario 6 — activitySummary: branch behavior', () => {
  const RANGE = { from: '2026-06-01', to: '2026-06-30' };

  it('calls getActivitySummary when no agent_id param is provided', async () => {
    svc.getActivitySummary.mockResolvedValue([
      { agent_id: 'ag1', full_name: 'Agent One', session_count: 3,
        available_seconds: 7200, break_seconds: 600,
        calls_offered: 10, calls_answered: 8, calls_missed: 2,
        total_ring_seconds: 200, total_talk_seconds: 4000,
        avg_talk_seconds: 500, occupancy_pct: 59.7,
        has_open_session: false },
    ]);

    const req = mockReq({ query: RANGE });
    const res = mockRes();

    await activitySummary(req, res);

    expect(svc.getActivitySummary).toHaveBeenCalledOnce();
    expect(svc.getActivityDetail).not.toHaveBeenCalled();

    const body = res.json.mock.calls[0][0];
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].agent_id).toBe('ag1');
  });

  it('calls getActivityDetail and wraps it in an array when agent_id is provided', async () => {
    svc.getActivityDetail.mockResolvedValue({
      agent_id:  'ag2',
      full_name: 'Agent Two',
      sessions:  { count: 2, first_login: null, last_activity: null,
                   total_login_seconds: 5000, has_open_session: false },
      state_durations: { available_seconds: 3000, break_seconds: 400 },
      call_metrics:    { calls_offered: 5, calls_answered: 4, calls_missed: 1,
                         total_ring_seconds: 80, total_talk_seconds: 2000,
                         avg_talk_seconds: 500 },
      occupancy:    { pct: 69.3 },
      open_warnings: [],
    });

    const req = mockReq({ query: { ...RANGE, agent_id: 'ag2' } });
    const res = mockRes();

    await activitySummary(req, res);

    expect(svc.getActivityDetail).toHaveBeenCalledOnce();
    expect(svc.getActivitySummary).not.toHaveBeenCalled();

    // Verify the single-agent result is wrapped in an array
    const body = res.json.mock.calls[0][0];
    expect(body.agents).toHaveLength(1);
    const row = body.agents[0];
    expect(row.agent_id).toBe('ag2');

    // Detail fields must be normalised to the flat summary shape
    expect(row.session_count).toBe(2);
    expect(row.total_login_seconds).toBe(5000);
    expect(row.available_seconds).toBe(3000);
    expect(row.break_seconds).toBe(400);
    expect(row.calls_offered).toBe(5);
    expect(row.occupancy_pct).toBeCloseTo(69.3);
  });

  it('occupancy_pct is null in the flat row when detail.occupancy.pct is null', async () => {
    svc.getActivityDetail.mockResolvedValue({
      agent_id: 'ag3', full_name: null,
      sessions:        { count: 0, first_login: null, last_activity: null,
                         total_login_seconds: 0, has_open_session: false },
      state_durations: { available_seconds: 0, break_seconds: 0 },
      call_metrics:    { calls_offered: 0, calls_answered: 0, calls_missed: 0,
                         total_ring_seconds: 0, total_talk_seconds: 0,
                         avg_talk_seconds: 0 },
      occupancy:    { pct: null },
      open_warnings: [],
    });

    const req = mockReq({ query: { ...RANGE, agent_id: 'ag3' } });
    const res = mockRes();

    await activitySummary(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.agents[0].occupancy_pct).toBeNull();
  });
});
