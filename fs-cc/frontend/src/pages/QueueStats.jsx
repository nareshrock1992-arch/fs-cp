import { useCallback, useEffect, useState } from 'react';
import { Stats } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import Panel from '../components/Panel.jsx';
import StatusLamp from '../components/StatusLamp.jsx';

function fmtSeconds(s) {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function SlaBar({ pct }) {
  const color = pct >= 80 ? 'bg-lamp-ok' : pct >= 60 ? 'bg-lamp-warn' : 'bg-lamp-alert';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full dark:bg-panel-border bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-mono tnum w-10 text-right dark:text-ink-dim text-gray-600">{pct}%</span>
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

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  useSocketEvent('call:enqueued',   load);
  useSocketEvent('call:bridged',    load);
  useSocketEvent('call:abandoned',  load);
  useSocketEvent('call:bridge-end', load);
  useSocketEvent('channel:hangup',  load);
  useSocketEvent('agent:state',     load);
  useSocketEvent('agent:status',    load);

  const thClass = 'pb-2 font-display font-medium dark:text-ink-faint text-gray-400 text-[11px] uppercase tracking-widest whitespace-nowrap';

  if (loading) return <p className="text-sm dark:text-ink-dim text-gray-500">Loading queue statistics…</p>;
  if (error)   return <p className="text-sm text-lamp-alert">{error}</p>;

  return (
    <div className="space-y-6">
      {queues.length === 0 ? (
        <Panel title="Queue Statistics">
          <p className="text-sm dark:text-ink-dim text-gray-500">No active queues found.</p>
        </Panel>
      ) : (
        queues.map(q => (
          <Panel key={q.queue_name} eyebrow={q.strategy} title={q.display_name || q.queue_name}>
            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
              {[
                { label: 'Waiting',         value: q.waiting,          tone: q.waiting > 0 ? 'amber' : null },
                { label: 'In Call',          value: q.active,           tone: q.active  > 0 ? 'green' : null },
                { label: 'Agents Available', value: q.available_agents, tone: q.available_agents > 0 ? 'green' : 'red' },
                { label: 'Longest Wait',     value: fmtSeconds(q.longest_wait_seconds), tone: null }
              ].map(({ label, value, tone }) => {
                const textColor = tone === 'green' ? 'text-lamp-ok'
                  : tone === 'amber' ? 'text-lamp-warn'
                  : tone === 'red'   ? 'text-lamp-alert'
                  : 'dark:text-ink text-gray-900';
                return (
                  <div key={label}>
                    <p className="text-[11px] uppercase tracking-widest font-display font-medium dark:text-ink-faint text-gray-400 mb-1">{label}</p>
                    <p className={`text-2xl font-semibold font-mono tnum ${textColor}`}>{value}</p>
                  </div>
                );
              })}
            </div>

            {/* Today's stats */}
            <div className="border-t dark:border-panel-border border-gray-100 pt-4">
              <p className="text-[11px] uppercase tracking-widest font-display font-medium dark:text-ink-faint text-gray-400 mb-3">Today</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b dark:border-panel-border border-gray-100">
                    <th className={thClass}>Offered</th>
                    <th className={thClass}>Answered</th>
                    <th className={thClass}>
                      <span title="Caller hung up before any agent was offered">Abandoned Queue</span>
                    </th>
                    <th className={thClass}>
                      <span
                        title="Agent was offered the call but did not answer"
                        className="underline decoration-dotted decoration-orange-400 cursor-help"
                      >
                        Missed by Agent
                      </span>
                    </th>
                    <th className={thClass}>Avg Wait</th>
                    <th className={thClass + ' w-40'}>SLA ({q.max_wait_time}s)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-2.5 font-mono tnum dark:text-ink text-gray-800">
                      {q.offered_today}
                    </td>
                    <td className="py-2.5 font-mono tnum text-lamp-ok">
                      {q.answered_today}
                    </td>
                    <td className="py-2.5 font-mono tnum text-lamp-alert">
                      {q.abandoned_queue_today ?? q.abandoned_today}
                    </td>
                    <td className="py-2.5 font-mono tnum text-orange-500 dark:text-orange-400">
                      {q.abandoned_agent_today ?? 0}
                    </td>
                    <td className="py-2.5 font-mono tnum dark:text-ink-dim text-gray-500">
                      {fmtSeconds(q.avg_wait_today)}
                    </td>
                    <td className="py-2.5 w-40">
                      <SlaBar pct={Number(q.sla_pct_today) || 0} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>
        ))
      )}
    </div>
  );
}
