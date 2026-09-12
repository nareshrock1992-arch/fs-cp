/**
 * Unit tests for agent-desk break + history behavior (agentDeskController.js).
 *
 * Covers: backward-compatible On Break without a code, On Break with a valid
 * code (snapshot passed to the session service), rejection of invalid/inactive
 * codes, and agent-scoping (req.agentId) of the history endpoints.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/agentDeskBreak.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/index.js', () => ({
  config: { jwt: { secret: 'test' } },
}));
vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/eslService.js', () => ({
  cc: { agentSetStatus: vi.fn().mockResolvedValue(undefined) },
  isConnected: vi.fn(() => true),
}));
vi.mock('../../../services/agentSessionService.js', () => ({
  handleStatusTransition: vi.fn().mockResolvedValue(undefined),
  reconcileOnStartup: vi.fn(),
}));

import { query } from '../../../db/pool.js';
import { cc } from '../../../services/eslService.js';
import * as agentSession from '../../../services/agentSessionService.js';
import {
  agentSetStatus, agentBreakHistory, agentCallHistory, agentCallHistoryDetail, agentMe,
} from '../../../controllers/agentDeskController.js';

function makeRes() {
  return {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b)   { this.body = b; return this; },
  };
}
const agentReq = (over = {}) => ({ agentId: 'alice', agentFullName: 'Alice', body: {}, params: {}, query: {}, ...over });

beforeEach(() => { vi.clearAllMocks(); query.mockResolvedValue({ rows: [] }); });

describe('agentSetStatus — status validation', () => {
  it('rejects an unknown status (400)', async () => {
    const res = makeRes();
    await agentSetStatus(agentReq({ body: { status: 'Napping' } }), res);
    expect(res.statusCode).toBe(400);
    expect(agentSession.handleStatusTransition).not.toHaveBeenCalled();
  });
});

describe('agentSetStatus — break code', () => {
  it('On Break WITHOUT a code stays backward compatible (breakInfo null)', async () => {
    const res = makeRes();
    await agentSetStatus(agentReq({ body: { status: 'On Break' } }), res);
    expect(res.statusCode).toBe(200);
    expect(cc.agentSetStatus).toHaveBeenCalledWith('alice', 'On Break');
    // handleStatusTransition called with null breakInfo
    expect(agentSession.handleStatusTransition).toHaveBeenCalledWith('alice', 'On Break', 'agent_self', null);
    expect(res.body.break_code).toBeNull();
  });

  it('On Break WITH a valid active code resolves + snapshots the name', async () => {
    // First query call = break_codes lookup
    query.mockResolvedValueOnce({ rows: [{ code: 'COFFEE', name: 'Coffee Break' }] });
    const res = makeRes();
    await agentSetStatus(agentReq({ body: { status: 'On Break', break_code: 'coffee' } }), res);
    expect(res.statusCode).toBe(200);
    // lookup normalized to upper-case
    expect(query.mock.calls[0][1]).toEqual(['COFFEE']);
    expect(agentSession.handleStatusTransition).toHaveBeenCalledWith(
      'alice', 'On Break', 'agent_self', { break_code: 'COFFEE', break_name: 'Coffee Break' });
    expect(res.body).toMatchObject({ break_code: 'COFFEE', break_name: 'Coffee Break' });
  });

  it('casts the break param in the agents UPDATE (Postgres type-inference regression)', async () => {
    // Phase 4.5: a bare $3 used only inside `IS NULL` makes Postgres throw
    // "could not determine data type of parameter $3". The cast prevents it.
    const res = makeRes();
    await agentSetStatus(agentReq({ body: { status: 'Available' } }), res);
    const agentsUpdate = query.mock.calls.find(c => /UPDATE agents/.test(c[0]));
    expect(agentsUpdate).toBeTruthy();
    expect(agentsUpdate[0]).toMatch(/\$3::varchar/);
  });

  it('rejects an invalid/inactive/non-selectable code (400) and does NOT transition', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // lookup finds nothing
    const res = makeRes();
    await agentSetStatus(agentReq({ body: { status: 'On Break', break_code: 'GONE' } }), res);
    expect(res.statusCode).toBe(400);
    expect(cc.agentSetStatus).not.toHaveBeenCalled();
    expect(agentSession.handleStatusTransition).not.toHaveBeenCalled();
  });
});

describe('agentMe exposes break fields for the timer', () => {
  it('selects break_code/break_started_at + break_name (join) scoped to req.agentId', async () => {
    query.mockResolvedValueOnce({ rows: [{ agent_id: 'alice', status: 'On Break', break_code: 'COFFEE', break_started_at: '2026-09-05T10:00:00Z', break_name: 'Coffee Break' }] });
    const res = makeRes();
    await agentMe(agentReq(), res);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/break_started_at/);
    expect(sql).toMatch(/break_name/);
    expect(sql).toMatch(/LEFT JOIN break_codes/i);
    expect(params).toEqual(['alice']);
    expect(res.body).toMatchObject({ break_code: 'COFFEE', break_name: 'Coffee Break' });
  });
});

describe('history endpoints are scoped to req.agentId', () => {
  it('break-history first bound param is the authenticated agent', async () => {
    query.mockResolvedValue({ rows: [{ total: 0 }] });
    const res = makeRes();
    await agentBreakHistory(agentReq({ query: { page: '1', limit: '10' } }), res);
    // every query issued must be scoped to alice as $1
    for (const call of query.mock.calls) expect(call[1][0]).toBe('alice');
    expect(res.body).toMatchObject({ page: 1, limit: 10 });
  });

  it('call-history first bound param is the authenticated agent', async () => {
    query.mockResolvedValue({ rows: [{ total: 0 }] });
    const res = makeRes();
    await agentCallHistory(agentReq({ query: {} }), res);
    for (const call of query.mock.calls) expect(call[1][0]).toBe('alice');
  });

  it('call-history detail is filtered by both call_uuid and agent_id', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // not found for this agent
    const res = makeRes();
    await agentCallHistoryDetail(agentReq({ params: { callUuid: 'abc-123' } }), res);
    expect(res.statusCode).toBe(404);
    expect(query.mock.calls[0][1]).toEqual(['abc-123', 'alice']);
  });

  it('call-history enforces max limit of 200', async () => {
    query.mockResolvedValue({ rows: [{ total: 0 }] });
    const res = makeRes();
    await agentCallHistory(agentReq({ query: { limit: '9999' } }), res);
    expect(res.body.limit).toBe(200);
  });
});
