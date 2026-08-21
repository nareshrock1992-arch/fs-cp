/**
 * Unit tests for buildContact() — canonical PAI contact builder.
 *
 * Verifies the server-side invariant:
 *   Every agent contact pushed to mod_callcenter must start with {sip_cid_type=pid}
 *   so FreeSWITCH sofia auto-generates P-Asserted-Identity on the B-leg INVITE.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Mock dependencies so the module loads without real DB/ESL connections ─────
vi.mock('../../../config/index.js', () => ({
  config: { fs: { sipDomain: 'fs.example.com' }, esl: { host: 'localhost', port: 8021, password: 'ClueCon', reconnectMs: 3000 } },
}));

vi.mock('../../../db/pool.js', () => ({ query: vi.fn() }));

vi.mock('../../../services/eslService.js', () => ({
  cc: {
    agentAdd:      vi.fn(),
    agentSetParam: vi.fn(),
    agentSetContact: vi.fn(),
    agentDel:      vi.fn(),
    agentSetStatus: vi.fn(),
    agentSetState:  vi.fn(),
  },
}));

vi.mock('../../../services/agentSessionService.js', () => ({
  handleStatusTransition: vi.fn(),
  reconcileOnStartup:     vi.fn(),
}));

// ── Import after mocking ──────────────────────────────────────────────────────
const { buildContact } = await import('../../../controllers/agentsController.js');

// ─────────────────────────────────────────────────────────────────────────────
// Internal agent tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContact — internal agent', () => {
  it('TEST 1: builds correct contact for internal agent', () => {
    const result = buildContact({ agentType: 'internal', extension: '1002' });
    expect(result).toBe('{sip_cid_type=pid}user/1002@fs.example.com');
  });

  it('TEST 2: trims whitespace from extension', () => {
    const result = buildContact({ agentType: 'internal', extension: '  1002  ' });
    expect(result).toBe('{sip_cid_type=pid}user/1002@fs.example.com');
  });

  it('TEST 3: throws 400 when extension is missing', () => {
    expect(() => buildContact({ agentType: 'internal' }))
      .toThrow('extension is required for internal agents');
  });

  it('TEST 4: throws 400 when extension is empty string', () => {
    expect(() => buildContact({ agentType: 'internal', extension: '   ' }))
      .toThrow('extension is required for internal agents');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gateway agent tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContact — gateway agent', () => {
  it('TEST 5: builds correct contact for gateway agent', () => {
    const result = buildContact({
      agentType:   'gateway',
      gateway:     'service-provider',
      destination: '0507221769',
    });
    expect(result).toBe('{sip_cid_type=pid}sofia/gateway/service-provider/0507221769');
  });

  it('TEST 6: throws 400 when gateway is missing', () => {
    expect(() => buildContact({ agentType: 'gateway', destination: '0507221769' }))
      .toThrow('gateway is required for gateway agents');
  });

  it('TEST 7: throws 400 when destination is missing', () => {
    expect(() => buildContact({ agentType: 'gateway', gateway: 'service-provider' }))
      .toThrow('destination is required for gateway agents');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency — already-prefixed contacts must not get double prefix
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContact — idempotency (no double prefix)', () => {
  it('TEST 8: already-prefixed internal contact → exactly one prefix', () => {
    const alreadyPrefixed = '{sip_cid_type=pid}user/1002@fs.example.com';
    const result = buildContact({ contact: alreadyPrefixed });
    const count = (result.match(/\{sip_cid_type=pid\}/g) || []).length;
    expect(count).toBe(1);
    expect(result).toBe('{sip_cid_type=pid}user/1002@fs.example.com');
  });

  it('TEST 9: already-prefixed gateway contact → exactly one prefix', () => {
    const alreadyPrefixed = '{sip_cid_type=pid}sofia/gateway/service-provider/0507221769';
    const result = buildContact({ contact: alreadyPrefixed });
    const count = (result.match(/\{sip_cid_type=pid\}/g) || []).length;
    expect(count).toBe(1);
    expect(result).toBe('{sip_cid_type=pid}sofia/gateway/service-provider/0507221769');
  });

  it('TEST 10: contact with unrelated prefix block → stripped, canonical prefix added', () => {
    const result = buildContact({ contact: '{some_var=old_val}user/1002@fs.example.com' });
    expect(result).toBe('{sip_cid_type=pid}user/1002@fs.example.com');
  });

  it('TEST 11: multiple prefix blocks → all stripped, canonical prefix added', () => {
    const result = buildContact({ contact: '{a=1}{b=2}sofia/gateway/gw/12345' });
    expect(result).toBe('{sip_cid_type=pid}sofia/gateway/gw/12345');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy raw contact path
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContact — legacy raw contact', () => {
  it('TEST 12: raw internal contact → prefix added', () => {
    const result = buildContact({ contact: 'user/1002@192.168.1.133' });
    expect(result).toBe('{sip_cid_type=pid}user/1002@192.168.1.133');
  });

  it('TEST 13: raw gateway contact → prefix added', () => {
    const result = buildContact({ contact: 'sofia/gateway/avaya_gw/5001' });
    expect(result).toBe('{sip_cid_type=pid}sofia/gateway/avaya_gw/5001');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error cases
// ─────────────────────────────────────────────────────────────────────────────

describe('buildContact — error cases', () => {
  it('TEST 14: no agentType and no contact → throws', () => {
    expect(() => buildContact({}))
      .toThrow('agentType (internal|gateway) or contact string is required');
  });

  it('TEST 15: unknown agentType with no contact → throws', () => {
    expect(() => buildContact({ agentType: 'unknown-type' }))
      .toThrow('agentType (internal|gateway) or contact string is required');
  });

  it('TEST 16: PAI prefix invariant — result always starts with {sip_cid_type=pid}', () => {
    const cases = [
      buildContact({ agentType: 'internal', extension: '1002' }),
      buildContact({ agentType: 'gateway', gateway: 'gw', destination: '05099' }),
      buildContact({ contact: 'user/1001@192.168.1.1' }),
      buildContact({ contact: '{sip_cid_type=pid}user/1001@192.168.1.1' }),
    ];
    for (const c of cases) {
      expect(c.startsWith('{sip_cid_type=pid}')).toBe(true);
    }
  });
});
