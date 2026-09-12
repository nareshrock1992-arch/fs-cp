/**
 * Unit tests for breakCodesController.js
 *
 * Strategy: mock db/pool.query and auditService; drive each controller function
 * with fake req/res and assert status codes, SQL params (normalization), and
 * audit calls. No live DB.
 *
 * Run: cd backend && npx vitest run src/__tests__/unit/breakCodesController.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));
vi.mock('../../../services/auditService.js', () => ({
  writeAudit: vi.fn().mockResolvedValue(1),
  staffActor: (req) => ({ actor: req.user?.username ?? 'unknown', actorRole: req.user?.role ?? 'unknown' }),
}));

import { query } from '../../../db/pool.js';
import { writeAudit } from '../../../services/auditService.js';
import {
  listBreakCodes, createBreakCode, updateBreakCode, setBreakCodeStatus,
} from '../../../controllers/breakCodesController.js';

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b)   { this.body = b; return this; },
  };
}
const adminReq = (over = {}) => ({ user: { username: 'sup1', role: 'supervisor' }, body: {}, params: {}, query: {}, ...over });

beforeEach(() => { vi.clearAllMocks(); });

describe('createBreakCode — validation', () => {
  it('creates a valid code (201) and normalizes code to upper-case + writes audit', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, code: 'COFFEE', name: 'Coffee' }] });
    const res = makeRes();
    await createBreakCode(adminReq({ body: { code: 'coffee', name: 'Coffee' } }), res);
    expect(res.statusCode).toBe(201);
    // code param passed to INSERT is normalized to COFFEE
    const [, params] = query.mock.calls[0];
    expect(params[0]).toBe('COFFEE');
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'BREAK_CODE_CREATED', entityType: 'break_code', entityId: 'COFFEE',
    }));
  });

  it('rejects missing code (400) without touching the DB', async () => {
    const res = makeRes();
    await createBreakCode(adminReq({ body: { name: 'X' } }), res);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects malformed code format (400)', async () => {
    const res = makeRes();
    await createBreakCode(adminReq({ body: { code: 'bad code!', name: 'X' } }), res);
    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects missing name (400)', async () => {
    const res = makeRes();
    await createBreakCode(adminReq({ body: { code: 'LUNCH' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects warn_threshold greater than max_duration (400)', async () => {
    const res = makeRes();
    await createBreakCode(adminReq({ body: { code: 'LUNCH', name: 'Lunch', max_duration_seconds: 60, warn_threshold_seconds: 120 } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('maps unique-violation (23505) to 409', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const res = makeRes();
    await createBreakCode(adminReq({ body: { code: 'COFFEE', name: 'Coffee' } }), res);
    expect(res.statusCode).toBe(409);
  });
});

describe('updateBreakCode', () => {
  it('rejects invalid id (400)', async () => {
    const res = makeRes();
    await updateBreakCode(adminReq({ params: { id: 'abc' }, body: { name: 'X' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the code does not exist', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // before-select
    const res = makeRes();
    await updateBreakCode(adminReq({ params: { id: '5' }, body: { name: 'New' } }), res);
    expect(res.statusCode).toBe(404);
  });

  it('updates and writes audit', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 5, code: 'LUNCH', name: 'Lunch', max_duration_seconds: null, warn_threshold_seconds: null }] }) // before
      .mockResolvedValueOnce({ rows: [{ id: 5, code: 'LUNCH', name: 'Lunch Break' }] }); // update RETURNING
    const res = makeRes();
    await updateBreakCode(adminReq({ params: { id: '5' }, body: { name: 'Lunch Break' } }), res);
    expect(res.statusCode).toBe(200);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'BREAK_CODE_UPDATED' }));
  });
});

describe('setBreakCodeStatus', () => {
  it('rejects non-boolean active (400)', async () => {
    const res = makeRes();
    await setBreakCodeStatus(adminReq({ params: { id: '5' }, body: { active: 'yes' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('deactivates and writes BREAK_CODE_DEACTIVATED audit', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 5, code: 'COFFEE', active: true }] })   // before
      .mockResolvedValueOnce({ rows: [{ id: 5, code: 'COFFEE', active: false }] }); // update
    const res = makeRes();
    await setBreakCodeStatus(adminReq({ params: { id: '5' }, body: { active: false } }), res);
    expect(res.statusCode).toBe(200);
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'BREAK_CODE_DEACTIVATED' }));
  });
});

describe('listBreakCodes', () => {
  it('returns rows and filters by active when requested', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, code: 'COFFEE' }] });
    const res = makeRes();
    await listBreakCodes(adminReq({ query: { active: 'true' } }), res);
    expect(res.body).toEqual([{ id: 1, code: 'COFFEE' }]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('WHERE active = $1');
    expect(params).toEqual([true]);
  });
});
