import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell
} from 'recharts';
import { Reports as ReportsApi } from '../api/client.js';
import Panel from '../components/Panel.jsx';
import CDRTable from '../components/reports/CDRTable.jsx';
import { inputClass, buttonPrimary } from '../components/form.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().slice(0, 10); }

const COLORS = {
  offered:   '#4C8EF5',   // blue
  answered:  '#27C98A',   // green
  abandoned: '#EF4444',   // red
  ivr:       '#F5A623',   // amber
};

// Distinct palette for IVR pie slices
const PIE_PALETTE = [
  '#4C8EF5', '#27C98A', '#F5A623', '#EF4444',
  '#A78BFA', '#F472B6', '#34D399', '#FB923C',
];

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
  { id: 'volume',  label: 'Volume Trend' },
  { id: 'queues',  label: 'Queue Performance' },
  { id: 'agents',  label: 'Agent Performance' },
  { id: 'ivr',     label: 'IVR Paths' },
  { id: 'cdr',     label: 'CDR Report' },
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
              ? 'border-lamp-live dark:text-ink text-gray-900'
              : 'border-transparent dark:text-ink-faint text-gray-400 hover:dark:text-ink-dim hover:text-gray-600'
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
  const [ivrPaths,  setIvrPaths]  = useState([]);
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
                  hover:dark:bg-panel-border hover:bg-gray-200 transition-colors"
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
        <div className="bg-white dark:bg-panel-surface rounded-xl shadow-md border border-gray-200 dark:border-panel-border overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-panel-border">
            <h3 className="text-base font-bold text-gray-800 dark:text-ink">Queue Performance</h3>
            <p className="text-xs text-gray-400 dark:text-ink-faint mt-0.5">
              Abandoned Queue = caller hung up before any agent offered · Missed by Agent = agent offered but did not answer
            </p>
          </div>
          {loading ? (
            <p className="text-sm dark:text-ink-dim text-gray-500 px-6 py-6">Loading…</p>
          ) : queuePerf.length === 0 ? (
            <p className="text-sm dark:text-ink-dim text-gray-500 px-6 py-6">No calls in this date range.</p>
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
        </div>
      )}

      {/* ── Agent Performance ─────────────────────────────────────────────── */}
      {tab === 'agents' && (
        <div className="bg-white dark:bg-panel-surface rounded-xl shadow-md border border-gray-200 dark:border-panel-border overflow-hidden">
          {/* Toolbar */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-panel-border">
            <h3 className="text-base font-bold text-gray-800 dark:text-ink">Agent Performance</h3>
            <p className="text-xs text-gray-400 dark:text-ink-faint mt-0.5">
              Sourced from agent_history — each row is one offer event
            </p>
          </div>
          {loading ? (
            <p className="text-sm dark:text-ink-dim text-gray-500 px-6 py-6">Loading…</p>
          ) : agentPerf.length === 0 ? (
            <p className="text-sm dark:text-ink-dim text-gray-500 px-6 py-6">
              No agent activity in this date range.
            </p>
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
        </div>
      )}

      {/* ── IVR Paths ─────────────────────────────────────────────────────── */}
      {tab === 'ivr' && (
        <Panel eyebrow="IVR" title="Selection Distribution">
          {loading ? (
            <p className="text-sm dark:text-ink-dim text-gray-500">Loading…</p>
          ) : ivrPaths.length === 0 ? (
            <p className="text-sm dark:text-ink-dim text-gray-500">No IVR data in this date range.</p>
          ) : (
            <div className="flex flex-col md:flex-row items-center gap-8">
              {/* Pie chart */}
              <div className="h-52 w-52 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={ivrPaths}
                      dataKey="calls"
                      nameKey="ivr_option"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={88}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {ivrPaths.map((_, i) => (
                        <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={ttip}
                      formatter={(v, name) => [`${v} calls`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Legend table */}
              <div className="flex-1 w-full">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b dark:border-panel-border border-gray-100 text-left">
                      <th className="pb-2 text-[11px] font-bold uppercase tracking-wider
                        dark:text-ink-faint text-gray-400">IVR Option</th>
                      <th className="pb-2 text-[11px] font-bold uppercase tracking-wider
                        dark:text-ink-faint text-gray-400 text-right">Calls</th>
                      <th className="pb-2 text-[11px] font-bold uppercase tracking-wider
                        dark:text-ink-faint text-gray-400 text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-panel-border divide-gray-100">
                    {(() => {
                      const total = ivrPaths.reduce((s, r) => s + Number(r.calls), 0);
                      return ivrPaths.map((r, i) => (
                        <tr key={r.ivr_option} className="hover:dark:bg-panel-raised/30 hover:bg-gray-50 transition-colors">
                          <td className="py-2.5 flex items-center gap-2.5">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ background: PIE_PALETTE[i % PIE_PALETTE.length] }}
                            />
                            <span className="dark:text-ink text-gray-800 font-medium">
                              {r.ivr_option || '(untracked)'}
                            </span>
                          </td>
                          <td className="py-2.5 font-mono tnum dark:text-ink-dim text-gray-600 text-right">
                            {r.calls}
                          </td>
                          <td className="py-2.5 font-mono tnum dark:text-ink-dim text-gray-500 text-right">
                            {total > 0 ? `${Math.round((r.calls / total) * 100)}%` : '—'}
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* ── CDR Report ────────────────────────────────────────────────────── */}
      {tab === 'cdr' && <CDRTable from={from} to={to} />}

    </div>
  );
}
