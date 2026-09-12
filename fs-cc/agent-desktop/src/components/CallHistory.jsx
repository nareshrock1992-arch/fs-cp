import { useState, useEffect, useCallback } from 'react';
import {
  PhoneIncoming, PhoneOutgoing, PhoneMissed, Search, X, Loader2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { api } from '../api/client.js';
import { formatDuration, formatDateTime, formatTime } from '../utils/format.js';

const LIMIT = 25; // stays well under the backend cap (200)

function DirectionBadge({ direction, missed, abandoned }) {
  if (missed || abandoned) {
    return <span className="inline-flex items-center gap-1 text-lamp-alert" title="Missed / abandoned">
      <PhoneMissed size={14} /> <span className="text-xs">Missed</span></span>;
  }
  return direction === 'outbound'
    ? <span className="inline-flex items-center gap-1 text-lamp-break" title="Outbound">
        <PhoneOutgoing size={14} /> <span className="text-xs">Out</span></span>
    : <span className="inline-flex items-center gap-1 text-lamp-available" title="Inbound">
        <PhoneIncoming size={14} /> <span className="text-xs">In</span></span>;
}

function DetailModal({ uuid, onClose }) {
  const [row, setRow] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    setLoading(true); setErr(null);
    api.callDetail(uuid)
      .then(d => { if (on) setRow(d); })
      .catch(e => { if (on) setErr(e.message || 'Failed to load call'); })
      .finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [uuid]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const Row = ({ label, value }) => (
    <div className="flex justify-between gap-4 py-1.5 border-b border-panel-border/50 last:border-0">
      <span className="text-xs text-ink-faint">{label}</span>
      <span className="text-xs text-ink-dim font-medium text-right">{value ?? '—'}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label="Call details">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-panel-border bg-panel-surface shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-panel-border">
          <h3 className="font-semibold text-sm text-ink">Call Details</h3>
          <button onClick={onClose} aria-label="Close" className="text-ink-faint hover:text-ink"><X size={18} /></button>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-ink-faint"><Loader2 className="animate-spin" size={20} /></div>
          ) : err ? (
            <p className="text-sm text-lamp-alert py-4">{err}</p>
          ) : row ? (
            <div>
              <Row label="Direction" value={row.direction === 'outbound' ? 'Outbound' : 'Inbound'} />
              <Row label="Caller" value={row.ani} />
              <Row label="Called" value={row.dnis} />
              <Row label="Queue" value={row.queue_name} />
              <Row label="Started" value={formatDateTime(row.start_time)} />
              <Row label="Answered" value={formatTime(row.agent_answer_time)} />
              <Row label="Ended" value={formatTime(row.end_time)} />
              <Row label="Ring" value={row.ring_seconds != null ? formatDuration(row.ring_seconds) : '—'} />
              <Row label="Talk" value={formatDuration(row.talk_seconds ?? row.agent_talk_seconds)} />
              <Row label="Total" value={formatDuration(row.total_seconds)} />
              <Row label="Disposition" value={row.disposition} />
              <Row label="Abandoned" value={row.abandoned ? 'Yes' : 'No'} />
              <Row label="Call UUID" value={<code className="text-[10px]">{row.call_uuid}</code>} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function CallHistory() {
  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [direction, setDir]   = useState('');
  const [search, setSearch]   = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);
  const [detail, setDetail]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.callHistory({ page, limit: LIMIT, direction, search });
      setRows(res.data || []);
      setTotal(res.total || 0);
    } catch (e) {
      setErr(e.message || 'Unable to load call history');
    } finally {
      setLoading(false);
    }
  }, [page, direction, search]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  function applySearch(e) { e.preventDefault(); setPage(1); setSearch(searchInput.trim()); }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink-dim uppercase tracking-wider">Call History</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={direction}
            onChange={e => { setPage(1); setDir(e.target.value); }}
            aria-label="Filter by direction"
            className="bg-panel-raised border border-panel-border rounded-lg text-xs text-ink-dim px-2 py-1.5"
          >
            <option value="">All directions</option>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
          <form onSubmit={applySearch} className="flex items-center gap-1">
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search number…"
                aria-label="Search caller or number"
                className="bg-panel-raised border border-panel-border rounded-lg text-xs text-ink-dim pl-7 pr-2 py-1.5 w-40"
              />
            </div>
          </form>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-ink-faint"><Loader2 className="animate-spin" size={22} /></div>
      ) : err ? (
        <div className="py-10 text-center">
          <p className="text-sm text-lamp-alert mb-2">{err}</p>
          <button onClick={load} className="btn border border-panel-border text-xs text-ink-dim">Try again</button>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-faint">No calls found for the selected filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-faint border-b border-panel-border">
                <th className="py-2 pr-3 font-semibold">Direction</th>
                <th className="py-2 pr-3 font-semibold">Caller</th>
                <th className="py-2 pr-3 font-semibold">Queue</th>
                <th className="py-2 pr-3 font-semibold">Started</th>
                <th className="py-2 pr-3 font-semibold">Talk</th>
                <th className="py-2 pr-3 font-semibold">Disposition</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr
                  key={c.call_uuid}
                  onClick={() => setDetail(c.call_uuid)}
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') setDetail(c.call_uuid); }}
                  className="border-b border-panel-border/40 hover:bg-panel-raised cursor-pointer focus:bg-panel-raised focus:outline-none"
                >
                  <td className="py-2 pr-3"><DirectionBadge direction={c.direction} missed={c.missed} abandoned={c.abandoned} /></td>
                  <td className="py-2 pr-3 text-ink-dim">{c.direction === 'outbound' ? c.dnis : c.ani || 'Anonymous'}</td>
                  <td className="py-2 pr-3 text-ink-faint">{c.queue_name || '—'}</td>
                  <td className="py-2 pr-3 text-ink-faint">{formatDateTime(c.start_time)}</td>
                  <td className="py-2 pr-3 text-ink-dim tabular-nums">{formatDuration(c.talk_seconds ?? c.agent_talk_seconds)}</td>
                  <td className="py-2 pr-3 text-ink-faint">{c.disposition || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !err && total > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-ink-faint">
          <span>{total} call{total === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="btn border border-panel-border p-1 disabled:opacity-40" aria-label="Previous page"><ChevronLeft size={14} /></button>
            <span>Page {page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="btn border border-panel-border p-1 disabled:opacity-40" aria-label="Next page"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}

      {detail && <DetailModal uuid={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
