import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock ──────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
vi.mock('../../../db/pool.js', () => ({ query: (...a) => mockQuery(...a) }));

// ── bcrypt mock (not needed for permissions tests but controller imports it) ──
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('$hashed') } }));

const { updatePermissions } = await import('../../../controllers/usersController.js');

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json   = vi.fn().mockReturnValue(res);
  res.end    = vi.fn().mockReturnValue(res);
  return res;
}

describe('updatePermissions', () => {
  let res;
  beforeEach(() => {
    res = mockRes();
    mockQuery.mockReset();
  });

  // ── 1. Sets valid permissions ──────────────────────────────────────────────
  it('updates and returns user with view_reports permission', async () => {
    const updated = { id: 2, username: 'sup', role: 'supervisor', permissions: ['view_reports'], created_at: new Date() };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const req = { params: { id: '2' }, body: { permissions: ['view_reports'] } };
    await updatePermissions(req, res);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE users SET permissions/);
    expect(params[0]).toEqual(['view_reports']);
    expect(params[1]).toBe(2);
    expect(res.json).toHaveBeenCalledWith(updated);
  });

  // ── 2. Sets change_agent_state permission ─────────────────────────────────
  it('accepts change_agent_state as a valid permission', async () => {
    const updated = { id: 3, username: 'sup2', role: 'supervisor', permissions: ['change_agent_state'], created_at: new Date() };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const req = { params: { id: '3' }, body: { permissions: ['change_agent_state'] } };
    await updatePermissions(req, res);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toEqual(['change_agent_state']);
    expect(res.json).toHaveBeenCalledWith(updated);
  });

  // ── 3. Sets both permissions together ────────────────────────────────────
  it('accepts both view_reports and change_agent_state together', async () => {
    const perms = ['view_reports', 'change_agent_state'];
    const updated = { id: 4, username: 'sup3', role: 'supervisor', permissions: perms, created_at: new Date() };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const req = { params: { id: '4' }, body: { permissions: perms } };
    await updatePermissions(req, res);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toEqual(perms);
  });

  // ── 4. Clears all permissions ──────────────────────────────────────────────
  it('accepts empty array to clear all permissions', async () => {
    const updated = { id: 2, username: 'sup', role: 'supervisor', permissions: [], created_at: new Date() };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const req = { params: { id: '2' }, body: { permissions: [] } };
    await updatePermissions(req, res);

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toEqual([]);
    expect(res.json).toHaveBeenCalledWith(updated);
  });

  // ── 5. Rejects non-array body ──────────────────────────────────────────────
  it('returns 400 when permissions is not an array', async () => {
    const req = { params: { id: '2' }, body: { permissions: 'view_reports' } };
    await updatePermissions(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ── 6. Rejects unknown permission strings ──────────────────────────────────
  it('returns 400 for unknown permission values — names them in error', async () => {
    const req = { params: { id: '2' }, body: { permissions: ['view_reports', 'make_admin'] } };
    await updatePermissions(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('make_admin') }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ── 7. Returns 404 when user not found ────────────────────────────────────
  it('returns 404 when no user matches the id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const req = { params: { id: '999' }, body: { permissions: ['view_reports'] } };
    await updatePermissions(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  // ── 8. Missing body defaults gracefully ───────────────────────────────────
  it('returns 400 when body is absent', async () => {
    const req = { params: { id: '2' }, body: null };
    await updatePermissions(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // ── 9. Rejects array with any unknown value ────────────────────────────────
  it('returns 400 for any unknown permission in the array', async () => {
    const req = { params: { id: '2' }, body: { permissions: ['UNKNOWN'] } };
    await updatePermissions(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ── 10. Admin permission grant: grants change_agent_state ─────────────────
  it('admin can grant change_agent_state to supervisor', async () => {
    const updated = { id: 5, username: 'sup4', role: 'supervisor', permissions: ['change_agent_state'], created_at: new Date() };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const req = { params: { id: '5' }, body: { permissions: ['change_agent_state'] } };
    await updatePermissions(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ permissions: ['change_agent_state'] }));
  });

  // ── 11. Admin permission revoke: clears change_agent_state ────────────────
  it('admin can revoke change_agent_state by sending empty array', async () => {
    const updated = { id: 5, username: 'sup4', role: 'supervisor', permissions: [], created_at: new Date() };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });

    const req = { params: { id: '5' }, body: { permissions: [] } };
    await updatePermissions(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ permissions: [] }));
  });
});
