const API_BASE = import.meta.env.VITE_API_URL || '/api';

function authHeaders() {
  const token = localStorage.getItem('agent_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Build a query string from a params object, skipping empty/undefined values.
function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.append(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  login:       (agent_id, pin) => request('POST', '/agent-desk/login', { agent_id, pin }),
  me:          ()              => request('GET',  '/agent-desk/me'),
  // setStatus keeps backward compatibility: with no breakCode it sends only
  // { status }. A break code is included only when explicitly provided.
  setStatus:   (status, breakCode) =>
    request('POST', '/agent-desk/status',
      breakCode ? { status, break_code: breakCode } : { status }),
  queues:      ()              => request('GET',  '/agent-desk/queues'),
  calls:       ()              => request('GET',  '/agent-desk/calls'),
  performance: ()              => request('GET',  '/agent-desk/performance'),
  eslStatus:   ()              => request('GET',  '/agent-desk/esl-status'),

  // ── Break management ──────────────────────────────────────────────────────
  breakCodes:   ()        => request('GET', '/agent-desk/break-codes'),
  breakHistory: (params)  => request('GET', `/agent-desk/break-history${qs(params)}`),

  // ── Call history ──────────────────────────────────────────────────────────
  callHistory:  (params)  => request('GET', `/agent-desk/call-history${qs(params)}`),
  callDetail:   (uuid)    => request('GET', `/agent-desk/call-history/${encodeURIComponent(uuid)}`),
};
