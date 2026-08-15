import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Minimal express-like req/res helpers ─────────────────────────────────────

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json   = vi.fn().mockReturnValue(res);
  return res;
}

function mockReq(overrides = {}) {
  return { headers: {}, user: null, ...overrides };
}

vi.mock('../../../config/index.js', () => ({
  config: { jwt: { secret: 'test-secret' } }
}));

const { requirePermission, requireAdmin } = await import('../../../middleware/auth.js');

// ── requirePermission ────────────────────────────────────────────────────────

describe('requirePermission', () => {
  let next;
  let res;

  beforeEach(() => {
    next = vi.fn();
    res  = mockRes();
  });

  // ── 1. Admin has access regardless of permissions ──────────────────────────
  it('passes admin regardless of empty permissions array', () => {
    const req = mockReq({ user: { role: 'admin', permissions: [] } });
    requirePermission('view_reports')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  // ── 2. Admin passes with undefined permissions field ──────────────────────
  it('passes admin with undefined permissions field', () => {
    const req = mockReq({ user: { role: 'admin' } });
    requirePermission('view_reports')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  // ── 3. Supervisor with view_reports passes reports check ──────────────────
  it('passes supervisor who holds view_reports', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: ['view_reports'] } });
    requirePermission('view_reports')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  // ── 4. Supervisor without view_reports gets 403 ───────────────────────────
  it('blocks supervisor without view_reports — returns 403', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: [] } });
    requirePermission('view_reports')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── 5. Supervisor with change_agent_state passes agent-state check ─────────
  it('passes supervisor who holds change_agent_state', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: ['change_agent_state'] } });
    requirePermission('change_agent_state')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  // ── 6. Supervisor without change_agent_state gets 403 ────────────────────
  it('blocks supervisor without change_agent_state — returns 403', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: ['view_reports'] } });
    requirePermission('change_agent_state')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── 7. Admin passes change_agent_state check unconditionally ─────────────
  it('passes admin for change_agent_state check without explicit permission', () => {
    const req = mockReq({ user: { role: 'admin', permissions: [] } });
    requirePermission('change_agent_state')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  // ── 8. Supervisor with null permissions is blocked ────────────────────────
  it('blocks supervisor with null permissions', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: null } });
    requirePermission('view_reports')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── 9. Missing req.user returns 401 ──────────────────────────────────────
  it('returns 401 when req.user is absent', () => {
    const req = mockReq({ user: null });
    requirePermission('view_reports')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // ── 10. Returns a function (closure check) ────────────────────────────────
  it('returns a middleware function with 3 arguments', () => {
    const mw = requirePermission('view_reports');
    expect(typeof mw).toBe('function');
    expect(mw.length).toBe(3);
  });

  // ── 11. Permission checks are independent — wrong perm is denied ──────────
  it('denies a supervisor who has view_reports but not change_agent_state', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: ['view_reports'] } });
    requirePermission('change_agent_state')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── 12. Empty permissions = no optional permissions ───────────────────────
  it('blocks supervisor with empty permissions from any protected route', () => {
    for (const perm of ['view_reports', 'change_agent_state']) {
      const n = vi.fn();
      const r = mockRes();
      const req = mockReq({ user: { role: 'supervisor', permissions: [] } });
      requirePermission(perm)(req, r, n);
      expect(n).not.toHaveBeenCalled();
      expect(r.status).toHaveBeenCalledWith(403);
    }
  });

  // ── 13. Multiple permissions — correct one grants access ──────────────────
  it('passes supervisor with both permissions for each guarded route', () => {
    for (const perm of ['view_reports', 'change_agent_state']) {
      const n = vi.fn();
      const r = mockRes();
      const req = mockReq({ user: { role: 'supervisor', permissions: ['view_reports', 'change_agent_state'] } });
      requirePermission(perm)(req, r, n);
      expect(n).toHaveBeenCalledOnce();
    }
  });
});

// ── requireAdmin ─────────────────────────────────────────────────────────────

describe('requireAdmin', () => {
  let next;
  let res;

  beforeEach(() => {
    next = vi.fn();
    res  = mockRes();
  });

  // ── 14. Admin-only user management remains Admin-only ─────────────────────
  it('allows admin through requireAdmin', () => {
    const req = mockReq({ user: { role: 'admin', permissions: [] } });
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  // ── 15. Supervisor is blocked by requireAdmin ──────────────────────────────
  it('blocks supervisor from admin-only routes even with all permissions', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: ['view_reports', 'change_agent_state'] } });
    requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── 16. Supervisor cannot modify permissions via requireAdmin guard ─────────
  it('supervisor cannot reach permission assignment endpoint (blocked by requireAdmin)', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: ['view_reports', 'change_agent_state'] } });
    requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  // ── 17. Missing user returns 403 ──────────────────────────────────────────
  it('returns 403 when req.user is absent', () => {
    const req = mockReq({ user: null });
    requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ── /status vs /state route authorization ────────────────────────────────────
// Verifies the semantic split introduced in routes/agents.js:
//   /status → requirePermission('change_agent_state')  — supervisor-controllable
//   /state  → requireAdmin                             — internal FS state, admin only

describe('/status vs /state authorization', () => {
  let next;
  let res;

  beforeEach(() => {
    next = vi.fn();
    res  = mockRes();
  });

  // ── Test 1: Admin → /status → allowed ─────────────────────────────────────
  it('admin passes requirePermission for /status', () => {
    const req = mockReq({ user: { role: 'admin', permissions: [] } });
    requirePermission('change_agent_state')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  // ── Test 2: Admin → /state → allowed ──────────────────────────────────────
  it('admin passes requireAdmin for /state', () => {
    const req = mockReq({ user: { role: 'admin', permissions: [] } });
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  // ── Test 3: Supervisor with change_agent_state → /status → allowed ─────────
  it('supervisor with change_agent_state passes requirePermission for /status', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: ['change_agent_state'] } });
    requirePermission('change_agent_state')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  // ── Test 4: Supervisor with change_agent_state → /state → 403 ──────────────
  it('supervisor with change_agent_state is blocked by requireAdmin on /state', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: ['change_agent_state'] } });
    requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── Test 5: Supervisor without change_agent_state → /status → 403 ──────────
  it('supervisor without change_agent_state is blocked by requirePermission on /status', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: [] } });
    requirePermission('change_agent_state')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── Test 6: Supervisor without change_agent_state → /state → 403 ───────────
  it('supervisor without change_agent_state is also blocked by requireAdmin on /state', () => {
    const req = mockReq({ user: { role: 'supervisor', permissions: [] } });
    requireAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── Test 7: Agent self-status middleware is unaffected ──────────────────────
  // requireAgentAuth (used by /api/agent-desk/status) is a separate function.
  // We verify it still exists and is exported from auth.js without modification.
  it('requireAgentAuth is still exported from auth.js (agent self-status unaffected)', async () => {
    const authModule = await import('../../../middleware/auth.js');
    expect(typeof authModule.requireAgentAuth).toBe('function');
  });
});
