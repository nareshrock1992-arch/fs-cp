import axios from 'axios';
import { getToken, clearToken } from '../hooks/useAuth.js';

// VITE_API_URL is baked in at build time:
//   Dev  (npm run dev):  /api      — Vite proxy forwards /api/* → cc-backend:4000
//   Prod (Docker/nginx): /cc/api   — nginx routes /cc/api/* → cc-backend /api/*
// Never hardcode an IP or absolute URL here — the proxy/nginx handles routing.
const API_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: API_URL,
  timeout: 10_000,
});

// Attach JWT on every request
api.interceptors.request.use(cfg => {
  const token = getToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Clear token + redirect to /login on 401
api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      clearToken();
      // Redirect to login within the same sub-path prefix (BASE_URL = /cc/ in prod, / in dev)
      window.location.href = (import.meta.env.BASE_URL || '/') + 'login';
    }
    return Promise.reject(err);
  }
);

// Auth API (no JWT — uses same relative base so proxy handles routing)
export const Auth = {
  login: (username, password) =>
    axios.post(`${API_URL}/auth/login`, { username, password }).then(r => r.data),
};

// ---- Users (admin only) ----
export const Users = {
  list:          ()             => api.get('/users').then(r => r.data),
  create:        (payload)      => api.post('/users', payload).then(r => r.data),
  update:        (id, payload)  => api.put(`/users/${id}`, payload).then(r => r.data),
  remove:        (id)           => api.delete(`/users/${id}`),
  resetPassword: (id, password) => api.post(`/users/${id}/reset-password`, { password }).then(r => r.data),
};

// ---- Agents ----
export const Agents = {
  list:      ()              => api.get('/agents').then(r => r.data),
  get:       (id)            => api.get(`/agents/${id}`).then(r => r.data),
  history:   (id)            => api.get(`/agents/${id}/history`).then(r => r.data),
  create:    (payload)       => api.post('/agents', payload).then(r => r.data),
  update:    (id, payload)   => api.put(`/agents/${id}`, payload).then(r => r.data),
  remove:    (id)            => api.delete(`/agents/${id}`),
  setStatus: (id, status)    => api.post(`/agents/${id}/status`, { status }).then(r => r.data),
  setState:  (id, state)     => api.post(`/agents/${id}/state`,  { state  }).then(r => r.data),
  setPin:    (id, pin)       => api.post(`/agents/${id}/set-pin`, { pin   }).then(r => r.data),
};

// ---- Queues ----
export const Queues = {
  list:       ()              => api.get('/queues').then(r => r.data),
  get:        (name)          => api.get(`/queues/${encodeURIComponent(name)}`).then(r => r.data),
  create:     (payload)       => api.post('/queues', payload).then(r => r.data),
  update:     (name, payload) => api.put(`/queues/${encodeURIComponent(name)}`, payload).then(r => r.data),
  remove:     (name)          => api.delete(`/queues/${encodeURIComponent(name)}`),
  addTier:    (name, payload) => api.post(`/queues/${encodeURIComponent(name)}/tiers`, payload).then(r => r.data),
  removeTier: (name, agentId) => api.delete(`/queues/${encodeURIComponent(name)}/tiers/${agentId}`),
};

// ---- Live calls ----
export const Calls = {
  live: () => api.get('/calls/live').then(r => r.data),
};

// ---- Stats / Reports ----
export const Stats = {
  dashboard: () => api.get('/stats/dashboard').then(r => r.data),
  queues:    () => api.get('/stats/queues').then(r => r.data),
};

export const Reports = {
  queuePerformance: (params) => api.get('/reports/queue-performance', { params }).then(r => r.data),
  agentPerformance: (params) => api.get('/reports/agent-performance', { params }).then(r => r.data),
  ivrPaths:         (params) => api.get('/reports/ivr-paths',         { params }).then(r => r.data),
  callVolume:       (params) => api.get('/reports/call-volume',        { params }).then(r => r.data),
  cdr:              (params) => api.get('/reports/cdr',                { params }).then(r => r.data),
  exportUrl: (type, format, from, to) => {
    const params = new URLSearchParams({ type, format, from, to });
    return `${API_URL}/reports/export?${params}`;
  },
};
