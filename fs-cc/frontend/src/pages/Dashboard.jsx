import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, PhoneIncoming, Timer, PhoneMissed, Gauge,
  LayoutDashboard, RefreshCw,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Stats, Agents as AgentsApi } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import KpiCard from '../components/KpiCard.jsx';
import Panel from '../components/Panel.jsx';
import StatusLamp from '../components/StatusLamp.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { KpiSkeleton } from '../components/LoadingState.jsx';

const QUEUE_COLORS = [
  '#2563EB', '#27C98A', '#F5A623', '#A78BFA',
  '#FB923C', '#34D399', '#60A5FA', '#EF4444',
];

function fmtSeconds(s) {
  if (s === undefined || s === null) return '--';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function fmtIdle(fromIso, nowMs) {
  if (!fromIso) return '--';
  const s = Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function QueueTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-white dark:bg-panel-raised dark:border-panel-border
                    border-gray-200 px-3 py-2 text-xs shadow-card">
      <p className="font-semibold text-gray-900 dark:text-ink">{d.displayName}</p>
      <p className="text-gray-500 dark:text-ink-dim mt-0.5">{d.value} offered · {d.share}%</p>
    </div>
  );
}

function QueuePerformance({ distribution }) {
  const totalOffered = distribution.reduce((s, q) => s + (q.offered_today || 0), 0);

  const colorOf = (queueName) => {
    const i = distribution.findIndex(q => q.queue_name === queueName);
    return QUEUE_COLORS[Math.max(0, i) % QUEUE_COLORS.length];
  };

  const chartData = distribution
    .filter(q => (q.offered_today || 0) > 0)
    .map(q => ({
      name:        q.queue_name,
      displayName: q.display_name || q.queue_name,
      value:       q.offered_today,
      share:       Math.round(q.offered_today / totalOffered * 100),
    }));

  return (
    <Panel eyebrow="Today" title="Queue Performance">
      <div className="flex flex-col lg:flex-row gap-6">

        {chartData.length > 0 && (
          <div className="flex flex-col items-center shrink-0 lg:w-52">
            <div className="relative w-44 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%" cy="50%"
                    innerRadius={52} outerRadius={74}
                    dataKey="value"
                    paddingAngle={2}
                    startAngle={90} endAngle={-270}
                  >
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={colorOf(entry.name)} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip content={<QueueTooltip />} />
                </PieChart>
              </ResponsiveContainer>

              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <p className="text-[9px] uppercase tracking-widest text-gray-400 dark:text-ink-faint leading-none">Total</p>
                  <p className="text-2xl font-bold font-mono text-gray-900 dark:text-ink leading-tight">{totalOffered}</p>
                  <p className="text-[9px] text-gray-400 dark:text-ink-faint leading-none">calls</p>
                </div>
              </div>
            </div>

            <div className="w-44 space-y-1.5 mt-2">
              {chartData.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: colorOf(d.name) }} />
                  <span className="flex-1 truncate text-gray-600 dark:text-ink-dim" title={d.displayName}>
                    {d.displayName}
                  </span>
                  <span className="font-mono tnum text-gray-400 dark:text-ink-faint shrink-0 w-8 text-right">
                    {d.share}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-x-auto">
          {distribution.length === 0 ? (
            <EmptyState title="No queues configured." />
          ) : totalOffered === 0 ? (
            <div>
              <p className="text-sm text-gray-500 dark:text-ink-dim mb-3">No calls offered today.</p>
              <div className="space-y-1">
                {distribution.map(q => (
                  <div key={q.queue_name} className="flex items-center gap-2 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: colorOf(q.queue_name) }} />
                    <span className="text-gray-500 dark:text-ink-dim">{q.display_name || q.queue_name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-panel-border text-left">
                  <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-ink-faint">Queue</th>
                  <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-ink-faint text-right">Offered</th>
                  <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-ink-faint text-right">Answered</th>
                  <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-ink-faint text-right hidden sm:table-cell">Abn</th>
                  <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-ink-faint text-right hidden sm:table-cell">Missed</th>
                  <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-ink-faint text-right">Ans%</th>
                  <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-ink-faint text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-panel-border">
                {distribution.map((q) => {
                  const offered  = q.offered_today         || 0;
                  const answered = q.answered_today        || 0;
                  const abanQ    = q.abandoned_queue_today || 0;
                  const abanA    = q.abandoned_agent_today || 0;
                  const share    = totalOffered > 0 ? Math.round(offered / totalOffered * 100) : 0;
                  const ansRate  = offered > 0 ? Math.round(answered / offered * 100) : 0;
                  const ansColor = offered === 0
                    ? 'text-gray-400 dark:text-ink-faint'
                    : ansRate >= 80 ? 'text-lamp-ok'
                    : ansRate >= 60 ? 'text-lamp-warn'
                    : 'text-lamp-alert';

                  return (
                    <tr key={q.queue_name}
                        className="hover:bg-gray-50 dark:hover:bg-panel-raised/30 transition-colors">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full shrink-0"
                                style={{ background: colorOf(q.queue_name) }} />
                          <span className="font-medium text-gray-800 dark:text-ink truncate max-w-[140px]"
                                title={q.display_name || q.queue_name}>
                            {q.display_name || q.queue_name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 font-mono tnum text-gray-800 dark:text-ink text-right">{offered}</td>
                      <td className="py-2.5 font-mono tnum text-lamp-ok text-right">{answered}</td>
                      <td className="py-2.5 font-mono tnum text-lamp-alert text-right hidden sm:table-cell">{abanQ}</td>
                      <td className="py-2.5 font-mono tnum text-amber-600 dark:text-amber-400 text-right hidden sm:table-cell">{abanA}</td>
                      <td className={`py-2.5 font-mono tnum text-right ${ansColor}`}>
                        {offered > 0 ? `${ansRate}%` : '—'}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-12 h-1.5 rounded-full bg-gray-200 dark:bg-panel-border overflow-hidden hidden md:block">
                            <div className="h-full rounded-full" style={{ width: `${share}%`, background: colorOf(q.queue_name) }} />
                          </div>
                          <span className="font-mono tnum text-gray-500 dark:text-ink-dim w-8 text-right">{share}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats,   setStats]   = useState(null);
  const [agents,  setAgents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [tick,    setTick]    = useState(Date.now());

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
    const poll = setInterval(load, 10000);
    return () => clearInterval(poll);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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

  if (loading) {
    return (
      <div className="space-y-6">
        <KpiSkeleton count={5} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="skeleton h-64 rounded-xl lg:col-span-2" />
          <div className="skeleton h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Panel title="Dashboard unavailable">
        <EmptyState
          icon={LayoutDashboard}
          title="Could not load dashboard data"
          body={error}
          action={
            <button onClick={load} className="btn-secondary gap-2">
              <RefreshCw size={14} /> Retry
            </button>
          }
        />
      </Panel>
    );
  }

  const totalWaiting = (stats.queueSnapshot || []).reduce((sum, q) => sum + q.waiting, 0);
  const abandoned    = stats.callsToday?.abandoned ?? 0;
  const queueDist    = stats.queueDistribution || [];

  return (
    <div className="space-y-6">

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiCard
          label="Agents Available"
          value={stats.agents?.Available ?? 0}
          tone="green"
          icon={Users}
          sub={`${stats.agents?.['On Break'] ?? 0} on break · ${stats.agents?.['Logged Out'] ?? 0} out`}
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
          label="Abandoned"
          value={abandoned}
          tone={abandoned > 0 ? 'red' : 'default'}
          icon={PhoneMissed}
          sub={stats.callsToday?.total > 0
            ? `${Math.round(abandoned / stats.callsToday.total * 100)}% of total`
            : undefined}
        />
      </div>

      {/* Queue Performance */}
      {queueDist.length > 0 && <QueuePerformance distribution={queueDist} />}

      {/* Queue Snapshot + Agent Roster */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Queue snapshot */}
        <Panel eyebrow="Live" title="Queue Snapshot" className="lg:col-span-2">
          {(!stats.queueSnapshot || stats.queueSnapshot.length === 0) ? (
            <EmptyState
              icon={PhoneIncoming}
              title="No calls in queue"
              body="No callers are currently waiting in any queue."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-100 dark:border-panel-border">
                  <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-ink-faint">Queue</th>
                  <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-ink-faint">Waiting</th>
                  <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-ink-faint">SLA Today</th>
                </tr>
              </thead>
              <tbody>
                {stats.queueSnapshot.map((q) => (
                  <tr key={q.queue_name} className="border-b border-gray-50 dark:border-panel-border/60 last:border-0">
                    <td className="py-3 font-medium text-gray-800 dark:text-ink">{q.queue_name}</td>
                    <td className="py-3">
                      <StatusLamp status="InQueue" label={`${q.waiting} waiting`} />
                    </td>
                    <td className="py-3 font-mono tnum text-gray-500 dark:text-ink-dim">{stats.slaPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {/* Agent roster */}
        <Panel eyebrow="Roster" title="Agent Status">
          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {sortedAgents.length === 0 ? (
              <EmptyState icon={Users} title="No agents configured yet." />
            ) : sortedAgents.map((a) => (
              <div key={a.agent_id}
                   className="flex items-center justify-between gap-3 py-1.5 px-3 rounded-lg
                              hover:bg-gray-50 dark:hover:bg-panel-raised/50 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-ink truncate">{a.full_name}</p>
                  <p className="text-[11px] text-gray-400 dark:text-ink-faint font-mono leading-none mt-0.5">
                    ext {a.avaya_extension}
                  </p>
                  {a.status === 'Available' && a.status_since && (
                    <p className="text-[10px] font-mono tnum text-lamp-available leading-none mt-0.5">
                      Idle {fmtIdle(a.status_since, tick)}
                    </p>
                  )}
                </div>
                <StatusLamp status={a.status} showLabel={false} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
