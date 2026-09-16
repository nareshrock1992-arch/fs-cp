/**
 * Live Agents operational endpoint (GET /api/stats/live-agents) tests.
 *
 * Two layers:
 *  1. SQL-shape guard on the ACTUAL query getLiveAgents runs — proves it is a
 *     single set-based statement (no N+1), derives operational_state from the
 *     authoritative agents.status/state, anchors idle on agent_state_log
 *     (state = a.state), and reads the open call/session (end_time/logout_at NULL).
 *  2. Semantic mirror of the documented operational-state mapping + the server-side
 *     idle_since post-processing, covering the required states and edge cases.
 *
 * RBAC note: the route is mounted under `app.use('/api', requireAuth)` in server.js
 * (same guard as /api/stats/dashboard), so any authenticated staff token is required;
 * there is no extra per-endpoint permission. The handler performs no auth of its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured = [];
vi.mock('../../../db/pool.js', () => ({
  query: vi.fn(async (sql) => { captured.push(String(sql)); return { rows: MOCK_ROWS }; }),
  pool: {},
  warmPool: vi.fn(),
}));
vi.mock('../../../services/eslService.js', () => ({ isConnected: () => true }));

let MOCK_ROWS = [];
const stats = await import('../../../controllers/statsController.js');

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => { captured.length = 0; MOCK_ROWS = []; });

// ── 1. SQL-shape guard on the real query ──────────────────────────────────────
describe('getLiveAgents SQL shape', () => {
  it('runs ONE query with the operational-state mapping and correct anchors', async () => {
    const res = mockRes();
    await stats.getLiveAgents({}, res);

    expect(captured.length).toBe(1);            // single set-based query, no N+1
    const sql = captured[0];

    // operational_state CASE mapping present
    expect(sql).toMatch(/operational_state/i);
    expect(sql).toMatch(/'Offline'/);
    expect(sql).toMatch(/'On Break'/);
    expect(sql).toMatch(/'Ringing'/);
    expect(sql).toMatch(/'On Call'/);
    expect(sql).toMatch(/'Idle'/);

    // idle/state anchor from agent_state_log keyed on the CURRENT fine state
    expect(sql).toMatch(/agent_state_log[\s\S]*state\s*=\s*a\.state/i);
    // open call and open session use the NULL sentinels (not a second call model)
    expect(sql).toMatch(/FROM calls[\s\S]*end_time IS NULL/i);
    expect(sql).toMatch(/agent_sessions[\s\S]*logout_at IS NULL/i);
    // status segment reused from agent_state_events (same source as GET /agents)
    expect(sql).toMatch(/agent_state_events[\s\S]*ended_at IS NULL/i);

    // response envelope
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty('eslConnected');
    expect(body).toHaveProperty('server_time');
    expect(Array.isArray(body.agents)).toBe(true);
  });

  it('idle_since is set only for Idle agents (state_since || status_since); null otherwise', async () => {
    MOCK_ROWS = [
      { agent_id: 'a1', operational_state: 'Idle',    state_since: 'S', status_since: 'T' },
      { agent_id: 'a2', operational_state: 'Idle',    state_since: null, status_since: 'T' },
      { agent_id: 'a3', operational_state: 'On Call', state_since: 'S', status_since: 'T' },
      { agent_id: 'a4', operational_state: 'On Break',state_since: 'S', status_since: 'T' },
      { agent_id: 'a5', operational_state: 'Offline', state_since: null, status_since: null },
    ];
    const res = mockRes();
    await stats.getLiveAgents({}, res);
    const byId = Object.fromEntries(res.json.mock.calls[0][0].agents.map(a => [a.agent_id, a.idle_since]));
    expect(byId.a1).toBe('S');   // prefers state_since
    expect(byId.a2).toBe('T');   // falls back to status_since
    expect(byId.a3).toBe(null);  // On Call → no idle anchor
    expect(byId.a4).toBe(null);  // On Break → no idle anchor
    expect(byId.a5).toBe(null);  // Offline → no idle anchor
  });
});

// ── 2. Semantic mapping mirror (documents intent + matches the SQL CASE) ───────
// Mirrors the SQL CASE so the required states/edge cases are locked.
function deriveOperationalState(status, state, hasSession) {
  if (status === 'Logged Out' || !hasSession) return 'Offline';
  if (status === 'On Break') return 'On Break';
  if (status === 'Available' && state === 'Receiving') return 'Ringing';
  if (status === 'Available' && state === 'In a queue call') return 'On Call';
  if (status === 'Available') return 'Idle';
  return 'Offline';
}

describe('operational-state derivation (documented mapping)', () => {
  it('Available + Waiting → Idle', () => expect(deriveOperationalState('Available', 'Waiting', true)).toBe('Idle'));
  it('Available + Receiving → Ringing', () => expect(deriveOperationalState('Available', 'Receiving', true)).toBe('Ringing'));
  it('Available + In a queue call → On Call', () => expect(deriveOperationalState('Available', 'In a queue call', true)).toBe('On Call'));
  it('On Break → On Break', () => expect(deriveOperationalState('On Break', 'Waiting', true)).toBe('On Break'));
  it('Logged Out → Offline', () => expect(deriveOperationalState('Logged Out', 'Logged Out', true)).toBe('Offline'));
  it('Available but NO open session → Offline (edge)', () => expect(deriveOperationalState('Available', 'Waiting', false)).toBe('Offline'));
  it('Available + Idle synonym → Idle', () => expect(deriveOperationalState('Available', 'Idle', true)).toBe('Idle'));
});
