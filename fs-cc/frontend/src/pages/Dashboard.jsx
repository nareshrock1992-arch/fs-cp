import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, PhoneIncoming, Timer, Gauge, PhoneMissed } from 'lucide-react';
import { Stats, Agents as AgentsApi } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import KpiCard from '../components/KpiCard.jsx';
import Panel from '../components/Panel.jsx';
import StatusLamp from '../components/StatusLamp.jsx';

function fmtSeconds(s) {
  if (s === undefined || s === null) return '--';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

export default function Dashboard() {
  const [stats, setStats]     = useState(null);
  const [agents, setAgents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([Stats.dashboard(), AgentsApi.list()]);
      setStats(s);
      setAgents(a);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const onLiveEvent = useCallback(() => load(), [load]);
  useSocketEvent('agent:state',    onLiveEvent);
  useSocketEvent('agent:status',   onLiveEvent);
  useSocketEvent('agent:update',   onLiveEvent);
  useSocketEvent('call:enqueued',  onLiveEvent);
  useSocketEvent('call:bridged',   onLiveEvent);
  useSocketEvent('channel:hangup', onLiveEvent);

  const sortedAgents = useMemo(() => {
    const order = { Available: 0, 'On Break': 1, 'Logged Out': 2 };
    return [...agents].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [agents]);

  if (loading) return <p className="text-sm dark:text-ink-dim text-gray-500">Loading dashboard…</p>;

  if (error) {
    return (
      <Panel title="Could not load dashboard">
        <p className="text-sm text-lamp-alert">{error}</p>
        <p className="text-xs dark:text-ink-dim text-gray-500 mt-2">
          Check that the backend API is running and reachable, and that it can reach Postgres.
        </p>
      </Panel>
    );
  }

  const totalWaiting = (stats.queueSnapshot || []).reduce((sum, q) => sum + q.waiting, 0);
  const abandoned    = stats.callsToday?.abandoned ?? 0;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          label="Agents Available"
          value={stats.agents?.Available ?? 0}
          tone="green"
          icon={Users}
          sub={`${stats.agents?.['On Break'] ?? 0} on break · ${stats.agents?.['Logged Out'] ?? 0} logged out`}
        />
        <KpiCard
          label="Calls Waiting"
          value={totalWaiting}
          tone={totalWaiting > 0 ? 'amber' : 'default'}
          icon={PhoneIncoming}
        />
        <KpiCard
          label="Calls Today"
          value={stats.callsToday?.total ?? 0}
          tone="blue"
          sub={`${stats.callsToday?.answered ?? 0} answered`}
          icon={Gauge}
        />
        <KpiCard
          label="Avg Wait"
          value={fmtSeconds(stats.callsToday?.avg_wait_seconds)}
          tone="amber"
          icon={Timer}
        />
        <KpiCard
          label="Abandoned Today"
          value={abandoned}
          tone={abandoned > 0 ? 'red' : 'default'}
          icon={PhoneMissed}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Queue snapshot */}
        <Panel eyebrow="Live" title="Queue Snapshot" className="lg:col-span-2">
          {(!stats.queueSnapshot || stats.queueSnapshot.length === 0) ? (
            <p className="text-sm dark:text-ink-dim text-gray-500">No calls currently waiting in any queue.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest dark:text-ink-faint text-gray-400 border-b dark:border-panel-border border-gray-100">
                  <th className="pb-2 font-display font-medium">Queue</th>
                  <th className="pb-2 font-display font-medium">Waiting</th>
                  <th className="pb-2 font-display font-medium">SLA (today)</th>
                </tr>
              </thead>
              <tbody>
                {stats.queueSnapshot.map((q) => (
                  <tr key={q.queue_name} className="border-b dark:border-panel-border/60 border-gray-50 last:border-0">
                    <td className="py-2.5 font-medium dark:text-ink text-gray-800">{q.queue_name}</td>
                    <td className="py-2.5">
                      <StatusLamp status="InQueue" label={`${q.waiting} waiting`} />
                    </td>
                    <td className="py-2.5 font-mono tnum dark:text-ink-dim text-gray-500">{stats.slaPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {/* Agent roster */}
        <Panel eyebrow="Roster" title="Agent Status">
          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {sortedAgents.length === 0 && (
              <p className="text-sm dark:text-ink-dim text-gray-500">No agents configured yet.</p>
            )}
            {sortedAgents.map((a) => (
              <div key={a.agent_id} className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium dark:text-ink text-gray-800 truncate">{a.full_name}</p>
                  <p className="text-[11px] dark:text-ink-faint text-gray-400 font-mono">ext {a.avaya_extension}</p>
                </div>
                <StatusLamp status={a.status} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
