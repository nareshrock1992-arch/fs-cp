import { useState, useEffect, useCallback } from 'react';
import { Coffee, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api/client.js';
import { formatDuration, formatDateTime } from '../utils/format.js';

const LIMIT = 25; // under the backend cap (200)

export default function BreakHistory({ breakCodes }) {
  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [code, setCode]       = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.breakHistory({ page, limit: LIMIT, break_code: code });
      setRows(res.data || []);
      setTotal(res.total || 0);
    } catch (e) {
      setErr(e.message || 'Unable to load break history');
    } finally {
      setLoading(false);
    }
  }, [page, code]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink-dim uppercase tracking-wider">Break History</h2>
        <select
          value={code}
          onChange={e => { setPage(1); setCode(e.target.value); }}
          aria-label="Filter by break reason"
          className="bg-panel-raised border border-panel-border rounded-lg text-xs text-ink-dim px-2 py-1.5"
        >
          <option value="">All reasons</option>
          {(breakCodes || []).map(bc => <option key={bc.code} value={bc.code}>{bc.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-ink-faint"><Loader2 className="animate-spin" size={22} /></div>
      ) : err ? (
        <div className="py-10 text-center">
          <p className="text-sm text-lamp-alert mb-2">{err}</p>
          <button onClick={load} className="btn border border-panel-border text-xs text-ink-dim">Try again</button>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-faint">No break history found for the selected filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-faint border-b border-panel-border">
                <th className="py-2 pr-3 font-semibold">Reason</th>
                <th className="py-2 pr-3 font-semibold">Started</th>
                <th className="py-2 pr-3 font-semibold">Ended</th>
                <th className="py-2 pr-3 font-semibold">Duration</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-panel-border/40">
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2 text-ink-dim">
                      <Coffee size={13} className="text-lamp-break" />
                      {/* Historical snapshot — NOT the current break-code name */}
                      {r.break_name || r.break_code || 'Break'}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-ink-faint">{formatDateTime(r.started_at)}</td>
                  <td className="py-2 pr-3 text-ink-faint">
                    {r.is_open ? <span className="text-lamp-break font-medium">In progress</span> : formatDateTime(r.ended_at)}
                  </td>
                  <td className="py-2 pr-3 text-ink-dim tabular-nums">{formatDuration(r.duration_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !err && total > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-ink-faint">
          <span>{total} break{total === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="btn border border-panel-border p-1 disabled:opacity-40" aria-label="Previous page"><ChevronLeft size={14} /></button>
            <span>Page {page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="btn border border-panel-border p-1 disabled:opacity-40" aria-label="Next page"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
