import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { Reports as ReportsApi } from '../api/client.js';
import Panel from '../components/Panel.jsx';
import CDRTable from '../components/reports/CDRTable.jsx';
import AgentSessionsTab from '../components/reports/AgentSessionsTab.jsx';
import { inputClass, buttonPrimary } from '../components/form.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().slice(0, 10); }

const COLORS = {
  offered:   '#4C8EF5',   // blue
  answered:  '#27C98A',   // green
  abandoned: '#EF4444',   // red
  ivr:       '#F5A623',   // amber
};

// ── IVR section table — reused for all three IVR Paths sections ──────────────

function IvrSection({ title, subtitle, rows, labelKey, labelHeader, color }) {
  const total = rows.reduce((s, r) => s + Number(r.calls), 0);
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider dark:text-ink text-gray-800 mb-0.5">
        {title}
      </p>
      <p className="text-[11px] dark:text-ink-faint text-gray-400 mb-2">{subtitle}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b dark:border-panel-border border-gray-100 text-left">
            <th className="pb-2 text-[11px] font-bold uppercase tracking-wider dark:text-ink-faint text-gray-400">
              {labelHeader}
            </th>
            <th className="pb-2 text-[11px] font-bold uppercase tracking-wider dark:text-ink-faint text-gray-400 text-right">
              Calls
            </th>
            <th className="pb-2 text-[11px] font-bold uppercase tracking-wider dark:text-ink-faint text-gray-400 text-right">
              Share
            </th>
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-panel-border divide-gray-100">
          {rows.map(r => (
            <tr key={r[labelKey]}
              className="dark:hover:bg-panel-raised/30 hover:bg-gray-50 transition-colors">
              <td className={`py-2 font-medium font-mono tnum ${color}`}>
                {r[labelKey] || '(unknown)'}
              </td>
              <td className="py-2 font-mono tnum dark:text-ink-dim text-gray-600 text-right">
                {r.calls}
              </td>
              <td className="py-2 font-mono tnum dark:text-ink-faint text-gray-400 text-right">
                {total > 0 ? `${r.share}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark'))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'volume',    label: 'Volume Trend' },
  { id: 'queues',    label: 'Queue Performance' },
  { id: 'agents',    label: 'Agent Performance' },
  { id: 'ivr',       label: 'IVR Paths' },
  { id: 'cdr',       label: 'CDR Report' },
  { id: 'sessions',  label: 'Agent Sessions' },
];

function TabBar({ active, onChange }) {
  return (
    <div className="flex gap-0 border-b dark:border-panel-border border-gray-200 overflow-x-auto">
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={[
            'px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px',
            active === t.id
              ? 'border-brand text-brand dark:text-brand-light font-bold'
              : 'border-transparent text-gray-500 dark:text-ink-faint hover:text-gray-700 dark:hover:text-ink-dim'
          ].join(' ')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Reports() {
  const isDark = useIsDark();
  const grid   = isDark ? { stroke: '#1C2A42' } : { stroke: '#e5e7eb' };
  const axis   = isDark
    ? { stroke: '#4C5A78', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fill: '#4C5A78' }
    : { stroke: '#9ca3af', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fill: '#6b7280' };
  const ttip   = isDark
    ? { background: '#0B1220', border: '1px solid #1C2A42', borderRadius: 6, fontSize: 12, color: '#E8ECF6' }
    : { background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12, color: '#111827' };

  const [tab,  setTab]  = useState('volume');
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 7 * 86400000)));
  const [to,   setTo]   = useState(isoDate(new Date()));

  const [volume,    setVolume]    = useState([]);
  const [queuePerf, setQueuePerf] = useState([]);
  const [agentPerf, setAgentPerf] = useState([]);
  const [ivrPaths,  setIvrPaths]  = useState({ dtmf: [], queues: [], other: [] });
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  // Load data for the non-CDR tabs (CDRTable fetches its own)
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { from, to };
      const [v, qp, ap, ivr] = await Promise.all([
        ReportsApi.callVolume(params),
        ReportsApi.queuePerformance(params),
        ReportsApi.agentPerformance(params),
        ReportsApi.ivrPaths(params)
      ]);
      setVolume(v);
      setQueuePerf(qp);
      setAgentPerf(ap);
      setIvrPaths(ivr);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => { load(); }, []);

  const thClass = 'pb-2 font-display font-medium dark:text-ink-faint text-gray-400 text-[11px] uppercase tracking-widest';

  return (
    <div className="space-y-5">

      {/* Date range + Apply + CSV exports */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium dark:text-ink-dim text-gray-600 mb-1.5">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium dark:text-ink-dim text-gray-600 mb-1.5">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputClass} />
        </div>
        <button className={buttonPrimary} onClick={load}>Apply</button>

        {/* CSV export links — only show for non-CDR tabs (CDR has its own export) */}
        {tab !== 'cdr' && (
          <div className="flex gap-2 ml-auto">
            {[
              { label: 'Queue CSV',  type: 'queue-performance', fmt: 'csv' },
              { label: 'Agent CSV',  type: 'agent-performance',  fmt: 'csv' },
              { label: 'Volume CSV', type: 'call-volume',         fmt: 'csv' }
            ].map(({ label, type, fmt }) => (
              <a
                key={type}
                href={ReportsApi.exportUrl(type, fmt, from, to)}
                download
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded
                  dark:bg-panel-border/60 bg-gray-100 dark:text-ink-dim text-gray-600
                  dark:hover:bg-panel-border hover:bg-gray-200 transition-colors"
              >
                <Download size={12} />
                {label}
              </a>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-lamp-alert">{error}</p>}

      {/* Tab navigation */}
      <TabBar active={tab} onChange={setTab} />

      {/* ── Volume Trend ─────────────────────────────────────────────────── */}
      {tab === 'volume' && (
        <Panel eyebrow="Trend" title="Call Volume">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={volume}>
                <CartesianGrid strokeDasharray="3 3" {...grid} vertical={false} />
                <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={{ stroke: grid.stroke }} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={ttip} />
                <Legend wrapperStyle={{ fontSize: 12, color: isDark ? '#8891A3' : '#6b7280' }} />
                <Line type="monotone" dataKey="offered"   stroke={COLORS.offered}   strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="answered"  stroke={COLORS.answered}  strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="abandoned" stroke={COLORS.abandoned} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {/* ── Queue Performance ─────────────────────────────────────────────── */}
      {tab === 'queues' && (
        <Panel eyebrow="Historical" title="Queue Performance" noPad>
          {loading ? (
            <div className="p-6"><p className="text-sm text-gray-500 dark:text-ink-dim">Loading…</p></div>
          ) : queuePerf.length === 0 ? (
            <div className="p-6"><p className="text-sm text-gray-500 dark:text-ink-dim">No calls in this date range.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-panel-border">
                    {[
                      'Queue', 'Offered', 'Answered',
                      'Abandoned Queue', 'Missed by Agent',
                      'ASA', 'AHT', 'Abandon %', 'SLA %'
                    ].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider
                        text-gray-500 bg-gray-50 dark:bg-panel-raised whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-panel-border">
                  {queuePerf.map(q => (
                    <tr key={q.queue_name}
                      className="hover:bg-blue-50/40 dark:hover:bg-panel-raised/40 transition-colors">
                      <td className="px-4 py-3 font-semibold dark:text-ink text-gray-800">{q.queue_name}</td>
                      <td className="px-4 py-3 font-mono tnum dark:text-ink-dim text-gray-500">{q.offered}</td>
                      <td className="px-4 py-3 font-mono tnum text-emerald-600 dark:text-emerald-400 font-semibold">{q.answered}</td>
                      <td className="px-4 py-3 font-mono tnum text-red-500 dark:text-red-400">{q.abandoned_queue ?? q.abandoned}</td>
                      <td className="px-4 py-3 font-mono tnum text-orange-500 dark:text-orange-400">{q.abandoned_agent ?? 0}</td>
                      <td className="px-4 py-3 font-mono tnum dark:text-ink-dim text-gray-500">{q.asa_seconds}s</td>
                      <td className="px-4 py-3 font-mono tnum dark:text-ink-dim text-gray-500">{q.aht_seconds}s</td>
                      <td className="px-4 py-3 font-mono tnum text-lamp-alert">{q.abandon_rate_pct}%</td>
                      <td className="px-4 py-3 font-mono tnum text-emerald-600 dark:text-emerald-400">
                        {q.sla_pct != null ? `${q.sla_pct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* ── Agent Performance ─────────────────────────────────────────────── */}
      {tab === 'agents' && (
        <Panel eyebrow="Historical" title="Agent Performance" noPad>
          {loading ? (
            <div className="p-6"><p className="text-sm text-gray-500 dark:text-ink-dim">Loading…</p></div>
          ) : agentPerf.length === 0 ? (
            <div className="p-6"><p className="text-sm text-gray-500 dark:text-ink-dim">No agent activity in this date range.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-panel-border">
                    {[
                      'Agent',
                      'Calls Offered',
                      'Calls Answered',
                      'Calls Missed',
                      'AHT (min)',
                      'Total Talk (min)'
                    ].map(h => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider
                          text-gray-500 bg-gray-50 dark:bg-panel-raised whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-panel-border">
                  {agentPerf.map(a => (
                    <tr
                      key={a.agent_id}
                      className="hover:bg-blue-50/40 dark:hover:bg-panel-raised/40 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800 dark:text-ink">
                          {a.full_name || a.agent_id}
                        </p>
                        <p className="text-[11px] dark:text-ink-faint text-gray-400 font-mono">
                          {a.agent_id}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono tnum text-gray-600 dark:text-ink-dim">
                        {a.calls_offered}
                      </td>
                      <td className="px-4 py-3 font-mono tnum font-semibold text-emerald-600 dark:text-emerald-400">
                        {a.calls_answered}
                      </td>
                      <td className="px-4 py-3 font-mono tnum text-orange-500 dark:text-orange-400">
                        {a.calls_missed}
                      </td>
                      <td className="px-4 py-3 font-mono tnum text-gray-600 dark:text-ink-dim">
                        {a.aht_min ?? '—'}
                      </td>
                      <td className="px-4 py-3 font-mono tnum text-gray-600 dark:text-ink-dim">
                        {a.total_talk_min ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {/* ── IVR / Call-Flow Activity ──────────────────────────────────────── */}
      {tab === 'ivr' && (
        <Panel eyebrow="IVR" title="Call Flow Activity">
          {loading ? (
            <p className="text-sm dark:text-ink-dim text-gray-500">Loading…</p>
          ) : (ivrPaths.queues.length === 0 && ivrPaths.other.length === 0) ? (
            <p className="text-sm dark:text-ink-dim text-gray-500">No IVR data in this date range.</p>
          ) : (
            <div className="space-y-6">

              {/* ── Section: Queue Destinations ───────────────────────────── */}
              {ivrPaths.queues.length > 0 && (
                <IvrSection
                  title="Queue Destinations"
                  subtitle="Calls that actually entered a FreeSWITCH queue (based on confirmed queue membership)."
                  rows={ivrPaths.queues}
                  labelKey="queue"
                  labelHeader="Queue"
                  color="text-lamp-ok"
                />
              )}

              {/* ── Section: Other System Events ──────────────────────────── */}
              {ivrPaths.other.length > 0 && (
                <IvrSection
                  title="Other System Events"
                  subtitle="FreeSWITCH application and system events recorded during the call."
                  rows={ivrPaths.other}
                  labelKey="step"
                  labelHeader="Event"
                  color="dark:text-ink-dim text-gray-500"
                />
              )}

            </div>
          )}
        </Panel>
      )}

      {/* ── CDR Report ────────────────────────────────────────────────────── */}
      {tab === 'cdr' && <CDRTable from={from} to={to} />}

      {/* ── Agent Sessions (Phase 2) ──────────────────────────────────────── */}
      {tab === 'sessions' && <AgentSessionsTab from={from} to={to} />}

    </div>
  );
}
