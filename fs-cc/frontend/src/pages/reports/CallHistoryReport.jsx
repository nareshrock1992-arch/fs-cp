import { useState, useEffect, useCallback } from 'react';
import { PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Reports, Agents } from '../../api/client.js';
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

function Dir({ c }) {
  if (c.missed || c.abandoned) return <span className="inline-flex items-center gap-1 text-lamp-alert"><PhoneMissed size={14} /><span className="text-xs">Missed</span></span>;
  return c.direction === 'outbound'
    ? <span className="inline-flex items-center gap-1 text-brand dark:text-brand-light"><PhoneOutgoing size={14} /><span className="text-xs">Out</span></span>
    : <span className="inline-flex items-center gap-1 text-lamp-available"><PhoneIncoming size={14} /><span className="text-xs">In</span></span>;
}

export default function CallHistoryReport() {
  const [rows, setRows]   = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage]   = useState(1);
  const [agent, setAgent] = useState('');
  const [dir, setDir]     = useState('');
  const [from, setFrom]   = useState('');
  const [to, setTo]       = useState('');
  const [search, setSearch]           = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => { Agents.list().then(setAgents).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await Reports.callHistory({
        page, limit: LIMIT, agent: agent || undefined, direction: dir || undefined,
        start_date: from || undefined, end_date: to || undefined, search: search || undefined,
      });
      setRows(res.data || []); setTotal(res.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load call history');
    } finally { setLoading(false); }
  }, [page, agent, dir, from, to, search]);

  useEffect(() => { load(); }, [load]);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const reset = (setter) => (e) => { setPage(1); setter(e.target.value); };

  return (
    <div className="max-w-6xl">
      <h1 className="font-display font-bold text-lg text-gray-900 dark:text-ink flex items-center gap-2 mb-4">
        <PhoneCall size={20} className="text-brand dark:text-brand-light" /> Call History
      </h1>

      <div className="flex flex-wrap gap-2 mb-4">
        <select className="field-input w-auto" value={agent} onChange={reset(setAgent)} aria-label="Agent">
          <option value="">All agents</option>
          {agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.full_name} ({a.agent_id})</option>)}
        </select>
        <select className="field-input w-auto" value={dir} onChange={reset(setDir)} aria-label="Direction">
          <option value="">All directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
        <input type="date" className="field-input w-auto" value={from} onChange={reset(setFrom)} aria-label="From date" />
        <input type="date" className="field-input w-auto" value={to} onChange={reset(setTo)} aria-label="To date" />
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(searchInput.trim()); }} className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-ink-faint" />
          <input className="field-input w-48 pl-8" placeholder="Search number…" aria-label="Search caller or number"
            value={searchInput} onChange={e => setSearchInput(e.target.value)} />
        </form>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-panel-border bg-white dark:bg-panel-surface overflow-hidden">
        {loading ? (
          <div className="p-5"><LoadingState rows={5} cols={6} label="Loading call history…" /></div>
        ) : error ? (
          <div className="p-6 text-center">
            <p className="text-sm text-lamp-alert mb-2">{error}</p>
            <button className="btn-secondary" onClick={load}>Try again</button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={PhoneCall} title="No calls" body="No calls match the selected filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-gray-400 dark:text-ink-faint border-b border-gray-100 dark:border-panel-border">
                  <th className="px-4 py-3 font-semibold">Direction</th>
                  <th className="px-4 py-3 font-semibold">Agent</th>
                  <th className="px-4 py-3 font-semibold">Caller</th>
                  <th className="px-4 py-3 font-semibold">Queue</th>
                  <th className="px-4 py-3 font-semibold">Started</th>
                  <th className="px-4 py-3 font-semibold">Wait</th>
                  <th className="px-4 py-3 font-semibold">Talk</th>
                  <th className="px-4 py-3 font-semibold">Disposition</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(c => (
                  <tr key={c.call_uuid} className="border-b border-gray-50 dark:border-panel-border/40">
                    <td className="px-4 py-3"><Dir c={c} /></td>
                    <td className="px-4 py-3 text-gray-700 dark:text-ink-dim">{c.agent_id || '—'}</td>
                    <td className="px-4 py-3 text-gray-800 dark:text-ink">{c.direction === 'outbound' ? c.dnis : c.ani || 'Anonymous'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-ink-faint">{c.queue_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-ink-faint">{fmtDT(c.start_time)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-ink-faint tabular-nums">{fmtDur(c.wait_seconds)}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-ink-dim tabular-nums">{fmtDur(c.talk_seconds)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-ink-faint">{c.disposition || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && !error && total > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-gray-500 dark:text-ink-faint">
          <span>{total} call{total === 1 ? '' : 's'}</span>
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
