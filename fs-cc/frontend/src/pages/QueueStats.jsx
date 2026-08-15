import { useCallback, useEffect, useState } from 'react';
import { Stats } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';

function fmtSeconds(s) {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function SlaBar({ pct }) {
  const color = pct >= 80 ? 'bg-lamp-ok' : pct >= 60 ? 'bg-lamp-warn' : 'bg-lamp-alert';
  return (
    <div className="flex items-center gap-1.5 mt-0.5">
      <div className="flex-1 h-1.5 rounded-full dark:bg-panel-border bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-mono tnum dark:text-ink-dim text-gray-600 shrink-0">{pct}%</span>
    </div>
  );
}

// Stat cell used in both Live and Today grids
function Stat({ label, value, colorClass, title }) {
  return (
    <div title={title}>
      <p className="text-[10px] uppercase tracking-widest font-display font-medium dark:text-ink-faint text-gray-400 leading-none mb-0.5">
        {label}
      </p>
      <p className={`text-sm font-semibold font-mono tnum ${colorClass ?? 'dark:text-ink text-gray-800'}`}>
        {value}
      </p>
    </div>
  );
}

function QueueCard({ q }) {
  // ── Frontend-derived metrics ────────────────────────────────────────────────
  const offered = q.offered_today ?? 0;

  // abandoned_today is returned directly by the API; fall back to breakdown sum
  const abandonedTotal = q.abandoned_today
    ?? ((q.abandoned_queue_today ?? 0) + (q.abandoned_agent_today ?? 0));

  const answerRate = offered > 0
    ? Math.round(q.answered_today / offered * 100)
    : 0;

  const abandonRate = offered > 0
    ? Math.round(abandonedTotal / offered * 100)
    : 0;

  // Color: answer rate — higher is better
  const answerRateColor = offered === 0
    ? 'dark:text-ink-dim text-gray-500'
    : answerRate >= 80 ? 'text-lamp-ok'
    : answerRate >= 60 ? 'text-lamp-warn'
    : 'text-lamp-alert';

  // Color: abandon rate — lower is better
  const abandonRateColor = offered === 0
    ? 'dark:text-ink-dim text-gray-500'
    : abandonRate === 0    ? 'text-lamp-ok'
    : abandonRate <= 10   ? 'text-lamp-warn'
    : 'text-lamp-alert';

  const slaVal = Number(q.sla_pct_today) || 0;

  return (
    <div className="rounded-lg border shadow-card dark:bg-panel-surface dark:border-panel-border bg-white border-gray-200">

      {/* Card header — compact py-2.5 vs Panel's py-3.5 */}
      <div className="px-4 py-2.5 border-b dark:border-panel-border border-gray-100">
        <p className="text-[9px] uppercase tracking-[0.12em] font-bold dark:text-brand-light text-blue-500 font-display mb-0.5">
          {q.strategy}
        </p>
        <h2 className="font-display font-semibold text-sm tracking-wide dark:text-ink text-gray-900">
          {q.display_name || q.queue_name}
        </h2>
      </div>

      <div className="p-4">

        {/* ── LIVE — 4 KPI tiles ──────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-3 mb-3">
          {[
            { label: 'Waiting',          value: q.waiting,          tone: q.waiting > 0 ? 'amber' : null },
            { label: 'In Call',           value: q.active,           tone: q.active  > 0 ? 'green' : null },
            { label: 'Agents Available',  value: q.available_agents, tone: q.available_agents > 0 ? 'green' : 'red' },
            { label: 'Longest Wait',      value: fmtSeconds(q.longest_wait_seconds), tone: null },
          ].map(({ label, value, tone }) => {
            const color = tone === 'green' ? 'text-lamp-ok'
              : tone === 'amber' ? 'text-lamp-warn'
              : tone === 'red'   ? 'text-lamp-alert'
              : 'dark:text-ink text-gray-900';
            return (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-widest font-display font-medium dark:text-ink-faint text-gray-400 leading-none mb-0.5">
                  {label}
                </p>
                <p className={`text-xl font-semibold font-mono tnum ${color}`}>{value}</p>
              </div>
            );
          })}
        </div>

        {/* ── TODAY — 4×2 compact stat grid ───────────────────────────── */}
        <div className="border-t dark:border-panel-border border-gray-100 pt-3">
          <p className="text-[10px] uppercase tracking-widest font-display font-medium dark:text-ink-faint text-gray-400 mb-2">
            Today
          </p>
          <div className="grid grid-cols-4 gap-x-3 gap-y-2.5">

            {/* Row 1: volume + efficiency */}
            <Stat label="Offered"     value={q.offered_today}  />
            <Stat label="Answered"    value={q.answered_today} colorClass="text-lamp-ok" />
            <Stat label="Answer Rate" value={`${answerRate}%`} colorClass={answerRateColor} />
            <Stat label="Avg Wait"    value={fmtSeconds(q.avg_wait_today)} colorClass="dark:text-ink-dim text-gray-500" />

            {/* Row 2: abandonment + SLA */}
            <Stat
              label="Abandoned Queue"
              value={q.abandoned_queue_today ?? q.abandoned_today}
              colorClass="text-lamp-alert"
              title="Caller hung up before any agent was offered"
            />
            <Stat
              label="Missed by Agent"
              value={q.abandoned_agent_today ?? 0}
              colorClass="text-orange-500 dark:text-orange-400"
              title="Agent was offered the call but did not answer"
            />
            <Stat label="Abandon Rate" value={`${abandonRate}%`} colorClass={abandonRateColor} />

            {/* SLA — keeps the bar visualization */}
            <div>
              <p className="text-[10px] uppercase tracking-widest font-display font-medium dark:text-ink-faint text-gray-400 leading-none mb-0.5">
                SLA ({q.max_wait_time}s)
              </p>
              <SlaBar pct={slaVal} />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

export default function QueueStats() {
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  const load = useCallback(async () => {
    try {
      setQueues(await Stats.queues());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Polling — unchanged
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  // Socket.IO live events — unchanged
  useSocketEvent('call:enqueued',   load);
  useSocketEvent('call:bridged',    load);
  useSocketEvent('call:abandoned',  load);
  useSocketEvent('call:bridge-end', load);
  useSocketEvent('channel:hangup',  load);
  useSocketEvent('agent:state',     load);
  useSocketEvent('agent:status',    load);

  if (loading) return <p className="text-sm dark:text-ink-dim text-gray-500">Loading queue statistics…</p>;
  if (error)   return <p className="text-sm text-lamp-alert">{error}</p>;

  // Responsive 2-column grid: 1 col on mobile, 2 cols from md (768px) up.
  // Any number of queues flows naturally:
  //   1 queue  → 1 card  (1 col)
  //   2 queues → 2 cards side-by-side
  //   3 queues → 2+1 across two rows
  //   4 queues → 2×2
  //   5+       → continues in 2-col rows
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {queues.length === 0 ? (
        <div className="col-span-full rounded-lg border shadow-card dark:bg-panel-surface dark:border-panel-border bg-white border-gray-200 p-5">
          <p className="text-sm dark:text-ink-dim text-gray-500">No active queues found.</p>
        </div>
      ) : (
        queues.map(q => <QueueCard key={q.queue_name} q={q} />)
      )}
    </div>
  );
}
