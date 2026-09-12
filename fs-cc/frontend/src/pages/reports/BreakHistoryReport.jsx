import { useState, useEffect, useCallback } from 'react';
import { Coffee, ChevronLeft, ChevronRight } from 'lucide-react';
import { Reports, BreakCodes, Agents } from '../../api/client.js';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';

const LIMIT = 25;

function fmtDur(s) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
function fmtDT(iso) { return iso ? new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }

export default function BreakHistoryReport() {
  const [rows, setRows]     = useState([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [agent, setAgent]   = useState('');
  const [code, setCode]     = useState('');
  const [from, setFrom]     = useState('');
  const [to, setTo]         = useState('');
  const [agents, setAgents] = useState([]);
  const [codes, setCodes]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    Agents.list().then(setAgents).catch(() => {});
    BreakCodes.list().then(setCodes).catch(() => {}); // may 403 if not manage_break_codes; ignore
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await Reports.breakHistory({
        page, limit: LIMIT, agent: agent || undefined, break_code: code || undefined,
        start_date: from || undefined, end_date: to || undefined,
      });
      setRows(res.data || []); setTotal(res.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load break history');
    } finally { setLoading(false); }
  }, [page, agent, code, from, to]);

  useEffect(() => { load(); }, [load]);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const reset = (setter) => (e) => { setPage(1); setter(e.target.value); };

  return (
    <div className="max-w-6xl">
      <h1 className="font-display font-bold text-lg text-gray-900 dark:text-ink flex items-center gap-2 mb-4">
        <Coffee size={20} className="text-brand dark:text-brand-light" /> Break History
      </h1>

      <div className="flex flex-wrap gap-2 mb-4">
        <select className="field-input w-auto" value={agent} onChange={reset(setAgent)} aria-label="Agent">
          <option value="">All agents</option>
          {agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.full_name} ({a.agent_id})</option>)}
        </select>
        <select className="field-input w-auto" value={code} onChange={reset(setCode)} aria-label="Break reason">
          <option value="">All reasons</option>
          {codes.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <input type="date" className="field-input w-auto" value={from} onChange={reset(setFrom)} aria-label="From date" />
        <input type="date" className="field-input w-auto" value={to} onChange={reset(setTo)} aria-label="To date" />
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-panel-border bg-white dark:bg-panel-surface overflow-hidden">
        {loading ? (
          <div className="p-5"><LoadingState rows={5} cols={5} label="Loading break history…" /></div>
        ) : error ? (
          <div className="p-6 text-center">
            <p className="text-sm text-lamp-alert mb-2">{error}</p>
            <button className="btn-secondary" onClick={load}>Try again</button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Coffee} title="No break history" body="No breaks match the selected filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 dark:text-ink-faint border-b border-gray-100 dark:border-panel-border">
                  <th className="px-4 py-3 font-semibold">Agent</th>
                  <th className="px-4 py-3 font-semibold">Reason</th>
                  <th className="px-4 py-3 font-semibold">Started</th>
                  <th className="px-4 py-3 font-semibold">Ended</th>
                  <th className="px-4 py-3 font-semibold">Duration</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 dark:border-panel-border/40">
                    <td className="px-4 py-3 text-gray-800 dark:text-ink">{r.full_name || r.agent_id}</td>
                    {/* Historical snapshot name — not the current break-code name */}
                    <td className="px-4 py-3 text-gray-600 dark:text-ink-dim">{r.break_name || r.break_code || 'Break'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-ink-faint">{fmtDT(r.started_at)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-ink-faint">{r.is_open ? <span className="text-brand dark:text-brand-light">In progress</span> : fmtDT(r.ended_at)}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-ink-dim tabular-nums">{fmtDur(r.duration_seconds)}</td>
                    <td className="px-4 py-3 text-gray-400 dark:text-ink-faint text-xs">{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && !error && total > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-gray-500 dark:text-ink-faint">
          <span>{total} break{total === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <button className="btn-secondary p-1.5" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous"><ChevronLeft size={14} /></button>
            <span>Page {page} / {totalPages}</span>
            <button className="btn-secondary p-1.5" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} aria-label="Next"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
