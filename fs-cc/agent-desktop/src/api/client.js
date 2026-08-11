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

export const api = {
  login:       (agent_id, pin) => request('POST', '/agent-desk/login', { agent_id, pin }),
  me:          ()              => request('GET',  '/agent-desk/me'),
  setStatus:   (status)        => request('POST', '/agent-desk/status', { status }),
  queues:      ()              => request('GET',  '/agent-desk/queues'),
  calls:       ()              => request('GET',  '/agent-desk/calls'),
  performance: ()              => request('GET',  '/agent-desk/performance'),
  eslStatus:   ()              => request('GET',  '/agent-desk/esl-status'),
};
