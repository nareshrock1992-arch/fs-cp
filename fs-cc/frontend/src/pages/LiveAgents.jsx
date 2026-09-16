import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Headphones, PhoneCall, PhoneIncoming, Coffee, PowerOff, UserCheck,
  Search, Timer, RefreshCw,
} from 'lucide-react';
import { Stats, Agents as AgentsApi } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import { useAuth } from '../hooks/useAuth.js';
import Panel from '../components/Panel.jsx';
import KpiCard from '../components/KpiCard.jsx';

// ── Operational-state visual config (matches the backend's derived labels) ─────
const STATE_META = {
  'Idle':     { label: 'Idle',     dot: '#27C98A', pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400', kpi: 'green'  },
  'Ringing':  { label: 'Ringing',  dot: '#F5A623', pill: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',       kpi: 'amber'  },
  'On Call':  { label: 'On Call',  dot: '#2563EB', pill: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',           kpi: 'blue'   },
  'On Break': { label: 'On Break', dot: '#A78BFA', pill: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400',   kpi: 'purple' },
  'Offline':  { label: 'Offline',  dot: '#4C5A78', pill: 'bg-gray-100 text-gray-500 dark:bg-panel-raised dark:text-ink-dim',          kpi: 'default'},
};
const STATE_ORDER = { 'On Call': 0, 'Ringing': 1, 'Idle': 2, 'On Break': 3, 'Offline': 4 };
const FILTERS = ['All', 'Idle', 'Ringing', 'On Call', 'On Break', 'Offline'];

// ── Duration formatting (seconds → "1:02:03" or "12m 34s" or "45s") ────────────
function fmtDur(sec) {
  if (sec == null || sec < 0) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
function secsSince(iso, nowMs) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}
function clockTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); // browser-local display of a UTC instant
}

export default function LiveAgents() {
  const { user } = useAuth();
  const canChangeState = user?.role === 'admin'
    || (Array.isArray(user?.permissions) && user.permissions.includes('change_agent_state'));

  const [agents, setAgents]   = useState([]);
  const [esl, setEsl]         = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tick, setTick]       = useState(Date.now());
  const skewRef = useRef(0); // serverTime - clientTime at last fetch, to align the local timer

  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('All');
  const [queue, setQueue]     = useState('All');
  const [sortBy, setSortBy]   = useState('state'); // state | agent | duration | idle

  // ── Data load (single request → whole board) ───────────────────────────────
  const load = useCallback(async () => {
    try {
      const data = await Stats.liveAgents();
      setAgents(Array.isArray(data.agents) ? data.agents : []);
      setEsl(!!data.eslConnected);
      if (data.server_time) skewRef.current = new Date(data.server_time).getTime() - Date.now();
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Fallback polling (resilience if a socket event is missed).
  useEffect(() => {
    const p = setInterval(load, 6000);
    return () => clearInterval(p);
  }, [load]);

  // One client-side 1s tick — durations increment locally, NO per-second requests.
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Debounced socket-driven refresh ─────────────────────────────────────────
  const debounceRef = useRef(null);
  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(load, 400);
  }, [load]);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  useSocketEvent('agent:status',   scheduleRefresh);
  useSocketEvent('agent:state',    scheduleRefresh);
  useSocketEvent('agent:offering', scheduleRefresh);
  useSocketEvent('agent:no-answer',scheduleRefresh);
  useSocketEvent('agent:update',   scheduleRefresh);
  useSocketEvent('call:bridged',   scheduleRefresh);
  useSocketEvent('call:bridge-end',scheduleRefresh);
  useSocketEvent('channel:hangup', scheduleRefresh);
  useSocketEvent('esl:status', useCallback((p) => { setEsl(!!p?.connected); scheduleRefresh(); }, [scheduleRefresh]));

  const nowMs = tick + skewRef.current;

  // ── Derived per-agent view (durations computed from server anchors) ─────────
  const rows = useMemo(() => agents.map(a => {
    const anchor = a.state_since || a.status_since;
    return {
      ...a,
      _stateDur: secsSince(anchor, nowMs),
      _idleDur:  a.operational_state === 'Idle' ? secsSince(a.idle_since, nowMs) : null,
      _loginDur: secsSince(a.login_at, nowMs),
    };
  }), [agents, nowMs]);

  // ── KPI counts ──────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const c = { Idle: 0, Ringing: 0, 'On Call': 0, 'On Break': 0, Offline: 0 };
    let longestIdle = null;
    for (const r of rows) {
      if (c[r.operational_state] !== undefined) c[r.operational_state]++;
      if (r.operational_state === 'Idle' && r._idleDur != null) {
        if (longestIdle == null || r._idleDur > longestIdle) longestIdle = r._idleDur;
      }
    }
    return { ...c, longestIdle };
  }, [rows]);

  // ── Queue filter options ────────────────────────────────────────────────────
  const queueOptions = useMemo(() => {
    const set = new Set();
    for (const a of agents) for (const q of (a.queues || [])) set.add(q.display_name || q.queue);
    return ['All', ...Array.from(set).sort()];
  }, [agents]);

  // ── Filter + search + sort ──────────────────────────────────────────────────
  const view = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = rows.filter(r => {
      if (filter !== 'All' && r.operational_state !== filter) return false;
      if (queue !== 'All' && !(r.queues || []).some(q => (q.display_name || q.queue) === queue)) return false;
      if (term) {
        const hay = `${r.full_name || ''} ${r.avaya_extension || ''} ${r.agent_id || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sortBy) {
        case 'agent':    return (a.full_name || '').localeCompare(b.full_name || '');
        case 'duration': return (b._stateDur ?? -1) - (a._stateDur ?? -1);
        case 'idle':     return (b._idleDur ?? -1) - (a._idleDur ?? -1); // longest idle first
        case 'state':
        default: {
          const d = (STATE_ORDER[a.operational_state] ?? 9) - (STATE_ORDER[b.operational_state] ?? 9);
          return d !== 0 ? d : (a.full_name || '').localeCompare(b.full_name || '');
        }
      }
    });
    return list;
  }, [rows, search, filter, queue, sortBy]);

  // ── Supervisor action: force status (reuses existing RBAC-guarded endpoint) ──
  const setStatus = useCallback(async (agentId, status) => {
    try { await AgentsApi.setStatus(agentId, status); }
    catch (err) { setError(`Status change failed: ${err.message}`); }
    finally { scheduleRefresh(); } // let the existing socket events + refresh propagate truth
  }, [scheduleRefresh]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return <p className="text-sm text-gray-500 dark:text-ink-dim">Loading live agents…</p>;

  const KPI = [
    { label: 'Idle / Available', value: kpis.Idle,       tone: 'green',   icon: UserCheck },
    { label: 'Ringing',          value: kpis.Ringing,    tone: 'amber',   icon: PhoneIncoming },
    { label: 'On Call',          value: kpis['On Call'], tone: 'blue',    icon: PhoneCall },
    { label: 'On Break',         value: kpis['On Break'],tone: 'purple',  icon: Coffee },
    { label: 'Offline',          value: kpis.Offline,    tone: 'default', icon: PowerOff },
    { label: 'Longest Idle',     value: fmtDur(kpis.longestIdle), tone: kpis.longestIdle > 600 ? 'amber' : 'default', icon: Timer },
  ];

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {KPI.map(k => <KpiCard key={k.label} {...k} />)}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50/60 dark:bg-red-500/5 px-4 py-2 text-sm text-red-600 dark:text-lamp-alert flex items-center gap-2">
          <RefreshCw size={14} /> {error}
        </div>
      )}

      <Panel
        eyebrow="Operations"
        title="Live Agents"
        noPad
        action={
          <div className="flex items-center gap-2 text-[11px]">
            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full font-semibold ${esl ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400'}`}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: esl ? '#27C98A' : '#EF4444' }} />
              {esl ? 'FS Connected' : 'FS Offline'}
            </span>
          </div>
        }
      >
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-gray-100 dark:border-panel-border">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-ink-faint" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name / extension"
              className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-panel-border bg-gray-50 dark:bg-panel-raised text-gray-900 dark:text-ink placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/40 w-56"
            />
          </div>
          <div className="flex items-center gap-1">
            {FILTERS.map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${filter === f ? 'bg-brand text-white border-brand' : 'border-gray-200 dark:border-panel-border text-gray-600 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-panel-raised'}`}>
                {f}{f !== 'All' && kpis[f] !== undefined ? ` ${kpis[f]}` : ''}
              </button>
            ))}
          </div>
          <select value={queue} onChange={e => setQueue(e.target.value)}
            className="ml-auto py-1.5 px-2 text-sm rounded-lg border border-gray-300 dark:border-panel-border bg-gray-50 dark:bg-panel-raised text-gray-700 dark:text-ink">
            {queueOptions.map(q => <option key={q} value={q}>{q === 'All' ? 'All queues' : q}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="py-1.5 px-2 text-sm rounded-lg border border-gray-300 dark:border-panel-border bg-gray-50 dark:bg-panel-raised text-gray-700 dark:text-ink">
            <option value="state">Sort: State</option>
            <option value="agent">Sort: Agent</option>
            <option value="duration">Sort: State duration</option>
            <option value="idle">Sort: Idle (longest)</option>
          </select>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-panel-border">
                {['Agent', 'Ext', 'State', 'State Duration', 'Idle', 'Queue(s)', 'Current Call', 'Since', canChangeState ? 'Actions' : ''].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-ink-faint bg-gray-50 dark:bg-panel-raised whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-panel-border/30">
              {view.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-ink-faint">
                  {agents.length === 0 ? 'No agents configured.' : 'No agents match the current filters.'}
                </td></tr>
              ) : view.map(r => {
                const meta = STATE_META[r.operational_state] || STATE_META['Offline'];
                const cc = r.current_call;
                return (
                  <tr key={r.agent_id} className="hover:bg-gray-50/60 dark:hover:bg-panel-raised/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-800 dark:text-ink truncate max-w-[180px]">{r.full_name || r.agent_id}</div>
                      {r._loginDur != null && r.operational_state !== 'Offline' && (
                        <div className="text-[10px] text-gray-400 dark:text-ink-faint">logged in {fmtDur(r._loginDur)}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono tnum text-gray-600 dark:text-ink-dim">{r.avaya_extension || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.pill}`}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
                        {meta.label}
                        {r.operational_state === 'On Break' && r.break_name ? ` · ${r.break_name}` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono tnum text-gray-700 dark:text-ink">{fmtDur(r._stateDur)}</td>
                    <td className={`px-4 py-2.5 font-mono tnum ${r._idleDur > 600 ? 'text-amber-600 dark:text-lamp-warn font-semibold' : 'text-gray-500 dark:text-ink-dim'}`}>
                      {r._idleDur != null ? fmtDur(r._idleDur) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-ink-dim truncate max-w-[160px]">
                      {(r.queues || []).map(q => q.display_name || q.queue).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {cc ? (
                        <span className="font-mono tnum text-xs text-gray-700 dark:text-ink">
                          {cc.ani || 'unknown'}{cc.queue_name ? ` → ${String(cc.queue_name).split('@')[0]}` : ''}
                        </span>
                      ) : <span className="text-gray-300 dark:text-ink-faint/50">—</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono tnum text-gray-400 dark:text-ink-faint">{clockTime(r.state_since || r.status_since)}</td>
                    {canChangeState && (
                      <td className="px-4 py-2.5">
                        <select
                          value=""
                          onChange={e => { if (e.target.value) setStatus(r.agent_id, e.target.value); }}
                          className="py-1 px-1.5 text-xs rounded border border-gray-200 dark:border-panel-border bg-white dark:bg-panel-raised text-gray-600 dark:text-ink-dim"
                        >
                          <option value="">Set…</option>
                          <option value="Available">Available</option>
                          <option value="On Break">On Break</option>
                          <option value="Logged Out">Logged Out</option>
                        </select>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
