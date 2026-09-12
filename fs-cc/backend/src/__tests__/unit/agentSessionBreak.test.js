/**
 * Unit tests for break-code threading in agentSessionService.handleStatusTransition.
 *
 * Verifies the snapshot write, the break-reason switch (close + reopen), and the
 * guarantee that a codeless FreeSWITCH/reconciliation event never wipes an
 * existing break-code snapshot.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/agentSessionBreak.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/pool.js', () => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  return { pool: { connect: vi.fn().mockResolvedValue(mockClient) }, __mockClient: mockClient };
});

import { __mockClient as client } from '../../../db/pool.js';
import { handleStatusTransition } from '../../../services/agentSessionService.js';

function setup({ openSession = { id: 1 }, openEvent = null } = {}) {
  client.query.mockImplementation(async (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('agent_sessions') && s.includes('logout_at IS NULL') && !s.includes('INSERT INTO') && !s.includes('id, agent_id FROM'))
      return { rows: openSession ? [openSession] : [] };
    if (s.includes('agent_state_events') && s.includes('ended_at IS NULL') && s.startsWith('SELECT'))
      return { rows: openEvent ? [openEvent] : [] };
    if (s.includes('INSERT INTO agent_sessions') && s.includes('RETURNING id'))
      return { rows: [{ id: openSession?.id ?? 1 }] };
    return { rows: [] };
  });
}
const inserts = () => client.query.mock.calls.filter(c => /INSERT INTO agent_state_events/.test(c[0]));
const closes  = () => client.query.mock.calls.filter(c => /UPDATE agent_state_events SET\s+ended_at/.test(c[0].replace(/\s+/g, ' ')));

beforeEach(() => { vi.clearAllMocks(); });

it('On Break with a break code snapshots code + name onto the new event', async () => {
  setup({ openSession: { id: 1 }, openEvent: null });
  await handleStatusTransition('alice', 'On Break', 'agent_self', { break_code: 'COFFEE', break_name: 'Coffee Break' });
  const ins = inserts();
  expect(ins).toHaveLength(1);
  // params: [agentId, sessionId, status, source, break_code, break_name]
  expect(ins[0][1][4]).toBe('COFFEE');
  expect(ins[0][1][5]).toBe('Coffee Break');
});

it('switching break reason closes the old segment and opens a new coded one', async () => {
  setup({ openSession: { id: 1 }, openEvent: { id: 9, status: 'On Break', break_code: 'COFFEE' } });
  await handleStatusTransition('alice', 'On Break', 'agent_self', { break_code: 'LUNCH', break_name: 'Lunch Break' });
  expect(closes()).toHaveLength(1);
  expect(closes()[0][1]).toEqual([9]);
  const ins = inserts();
  expect(ins).toHaveLength(1);
  expect(ins[0][1][4]).toBe('LUNCH');
});

it('a codeless event on an existing coded break is a no-op (snapshot preserved)', async () => {
  setup({ openSession: { id: 1 }, openEvent: { id: 9, status: 'On Break', break_code: 'COFFEE' } });
  await handleStatusTransition('alice', 'On Break', 'fs_event'); // no breakInfo
  expect(closes()).toHaveLength(0);
  expect(inserts()).toHaveLength(0);
});

it('Available after On Break closes the open break event', async () => {
  setup({ openSession: { id: 1 }, openEvent: { id: 9, status: 'On Break', break_code: 'COFFEE' } });
  await handleStatusTransition('alice', 'Available', 'agent_self');
  expect(closes()).toHaveLength(1);
  expect(closes()[0][1]).toEqual([9]);
  // a new Available event (no break code) is opened
  const ins = inserts();
  expect(ins).toHaveLength(1);
  expect(ins[0][1][2]).toBe('Available');
  expect(ins[0][1][4]).toBeNull();
});
