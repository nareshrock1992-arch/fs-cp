import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, PhoneIncoming, Timer, PhoneMissed, Gauge,
  LayoutDashboard, RefreshCw, Phone, PhoneOff, PhoneCall,
  Activity, CheckCircle2, UserCheck, UserX, Coffee,
  Radio, Bell,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { Stats, Agents as AgentsApi } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import KpiCard from '../components/KpiCard.jsx';
import Panel from '../components/Panel.jsx';
import StatusLamp from '../components/StatusLamp.jsx';
import { KpiSkeleton } from '../components/LoadingState.jsx';

// ─── Constants ────────────────────────────────────────────────────────────────

const QUEUE_COLORS = [
  '#2563EB', '#27C98A', '#F5A623', '#A78BFA',
  '#FB923C', '#34D399', '#60A5FA', '#EF4444',
];

// ─── Utilities ────────────────────────────────────────────────────────────────

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
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function queueColor(name, distribution) {
  const i = (distribution || []).findIndex(q => q.queue_name === name);
  return QUEUE_COLORS[Math.max(0, i) % QUEUE_COLORS.length];
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ─── Service Level Gauge (compact) ───────────────────────────────────────────

function ServiceLevelGauge({ pct }) {
  const r = 40;
  const cx = 50, cy = 50;
  const circumference = 2 * Math.PI * r;
  const safe   = Math.min(100, Math.max(0, pct || 0));
  const offset = circumference - (safe / 100) * circumference;
  const stroke = safe >= 80 ? '#27C98A' : safe >= 60 ? '#F5A623' : '#EF4444';
  const status = safe >= 80 ? 'Excellent' : safe >= 60 ? 'Warning' : 'Critical';

  return (
    <div className="flex items-center gap-3">
      <svg width="100" height="100" viewBox="0 0 100 100" className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="currentColor" strokeWidth="7"
          className="text-gray-100 dark:text-panel-raised" />
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={stroke} strokeWidth="7"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.7s ease, stroke 0.4s ease' }}
        />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="18" fontWeight="700"
          fill={stroke} fontFamily="IBM Plex Mono, monospace">{safe}%</text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize="8"
          fill="#8B99B8" fontFamily="Inter, sans-serif">SLA</text>
      </svg>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-700 dark:text-ink">Service Level</p>
        <p className="text-[10px] font-bold uppercase tracking-wider mt-0.5" style={{ color: stroke }}>
          {status}
        </p>
        <p className="text-[10px] text-gray-400 dark:text-ink-faint mt-1 leading-relaxed">
          Target: ≥80% of calls<br />answered within 20s
        </p>
      </div>
    </div>
  );
}

// ─── Agent Distribution Donut ─────────────────────────────────────────────────

function AgentStatusDonut({ agents }) {
  const rows = [
    { name: 'Available',  count: agents?.Available      || 0, color: '#27C98A' },
    { name: 'On Break',   count: agents?.['On Break']   || 0, color: '#4C8EF5' },
    { name: 'Logged Out', count: agents?.['Logged Out'] || 0, color: '#4C5A78' },
  ];
  const total = rows.reduce((s, d) => s + d.count, 0);
  const data  = rows.filter(d => d.count > 0);

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-14 h-14 shrink-0">
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%"
                innerRadius={18} outerRadius={26}
                dataKey="count" paddingAngle={2}
                startAngle={90} endAngle={-270}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.color} stroke="transparent" />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full rounded-full border-4 border-gray-100 dark:border-panel-border
            flex items-center justify-center">
            <span className="text-[10px] font-mono text-gray-400 dark:text-ink-faint">0</span>
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs font-bold font-mono dark:text-ink text-gray-900">{total}</span>
        </div>
      </div>

      <div className="flex-1 space-y-1.5 min-w-0">
        {rows.map(({ name, count, color }) => {
          const pct = total > 0 ? Math.round(count / total * 100) : 0;
          return (
            <div key={name} className="flex items-center gap-1.5 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
              <span className="flex-1 text-gray-500 dark:text-ink-dim truncate">{name}</span>
              <span className="font-mono tnum font-semibold text-gray-700 dark:text-ink w-3 text-right">{count}</span>
              <span className="font-mono tnum text-gray-400 dark:text-ink-faint w-7 text-right">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Bar Chart Tooltip ────────────────────────────────────────────────────────

function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white dark:bg-panel-raised dark:border-panel-border
                    border-gray-200 px-3 py-2 text-xs shadow-card-hover">
      <p className="font-semibold text-gray-800 dark:text-ink mb-1.5">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1 last:mb-0">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: p.fill }} />
          <span className="text-gray-500 dark:text-ink-dim w-14">{p.name}:</span>
          <span className="font-mono font-semibold" style={{ color: p.fill }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Queue Performance Section ────────────────────────────────────────────────
// Side-by-side: bar chart (left) + table (right)
// When no calls, chart shows ghost axes; table shows zeros — no dead empty state.

function QueuePerformanceSection({ distribution }) {
  const totalOffered = distribution.reduce((s, q) => s + (q.offered_today || 0), 0);

  const chartData = distribution.map(q => ({
    name: (q.display_name || q.queue_name)
      .replace(/\bSupport\b/gi, 'Sup')
      .replace(/\bQueue\b/gi, 'Q'),
    Offered:   q.offered_today || 0,
    Answered:  q.answered_today || 0,
    Abandoned: (q.abandoned_queue_today || 0) + (q.abandoned_agent_today || 0),
  }));

  const legend = (
    <div className="hidden sm:flex items-center gap-3 text-[10px] text-gray-400 dark:text-ink-faint">
      {[['#3B82F6','Offered'],['#27C98A','Answered'],['#EF4444','Abandoned']].map(([c, l]) => (
        <span key={l} className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );

  return (
    <Panel eyebrow="Today" title="Queue Performance" action={legend}>
      {distribution.length === 0 ? (
        /* No queues configured at all — truly compact */
        <div className="flex items-center gap-3 py-3 text-gray-400 dark:text-ink-faint">
          <Activity size={16} strokeWidth={1.5} className="shrink-0" />
          <p className="text-xs">No queues configured yet.</p>
        </div>
      ) : (
        /* Side-by-side: chart left, table right */
        <div className="flex gap-4">
          {/* Chart */}
          <div className="relative" style={{ flex: '0 0 42%', minWidth: 0 }}>
            <ResponsiveContainer width="100%" height={130}>
              <BarChart data={chartData}
                margin={{ top: 2, right: 2, left: -28, bottom: 0 }}
                barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3"
                  stroke="rgba(139,153,184,0.10)" vertical={false} />
                <XAxis dataKey="name"
                  tick={{ fontSize: 9, fill: '#8B99B8', fontFamily: 'Inter, sans-serif' }}
                  axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 9, fill: '#8B99B8', fontFamily: 'Inter, sans-serif' }}
                  axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(139,153,184,0.06)' }} />
                <Bar dataKey="Offered"   name="Offered"   fill="#3B82F6" radius={[2,2,0,0]} />
                <Bar dataKey="Answered"  name="Answered"  fill="#27C98A" radius={[2,2,0,0]} />
                <Bar dataKey="Abandoned" name="Abandoned" fill="#EF4444" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
            {totalOffered === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[10px] text-gray-400 dark:text-ink-faint bg-white/80
                  dark:bg-panel-surface/80 px-2 py-1 rounded">
                  No calls today
                </span>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="flex-1 min-w-0 overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 240 }}>
              <thead>
                <tr className="border-b border-gray-100 dark:border-panel-border">
                  {[
                    ['Queue',    'text-left',  ''],
                    ['Off',      'text-right', 'w-7'],
                    ['Ans',      'text-right', 'w-7'],
                    ['Ab',       'text-right', 'w-7'],
                    ['Ans%',     'text-right', 'w-9'],
                  ].map(([h, align, w]) => (
                    <th key={h} className={`pb-2 text-[9px] font-semibold uppercase
                      tracking-wider text-gray-400 dark:text-ink-faint ${align} ${w}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-panel-border/20">
                {distribution.map((q) => {
                  const offered   = q.offered_today         || 0;
                  const answered  = q.answered_today        || 0;
                  const abandoned = (q.abandoned_queue_today || 0) + (q.abandoned_agent_today || 0);
                  const ansRate   = offered > 0 ? Math.round(answered / offered * 100) : null;
                  const color     = queueColor(q.queue_name, distribution);
                  const ansColor  = ansRate === null
                    ? 'text-gray-300 dark:text-ink-faint/40'
                    : ansRate >= 80 ? 'text-emerald-600 dark:text-lamp-ok'
                    : ansRate >= 60 ? 'text-amber-500 dark:text-lamp-warn'
                    : 'text-red-500 dark:text-lamp-alert';

                  return (
                    <tr key={q.queue_name}
                      className="hover:bg-gray-50/60 dark:hover:bg-panel-raised/20 transition-colors">
                      <td className="py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ background: color }} />
                          <span className="font-medium text-gray-700 dark:text-ink truncate"
                            title={q.display_name || q.queue_name}
                            style={{ maxWidth: 100 }}>
                            {q.display_name || q.queue_name}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 font-mono tnum text-gray-600 dark:text-ink text-right">{offered}</td>
                      <td className="py-2 font-mono tnum text-emerald-600 dark:text-lamp-ok text-right font-semibold">{answered}</td>
                      <td className="py-2 font-mono tnum text-red-400 dark:text-lamp-alert text-right">{abandoned}</td>
                      <td className={`py-2 font-mono tnum text-right font-semibold ${ansColor}`}>
                        {ansRate !== null ? `${ansRate}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ─── Metric Row ───────────────────────────────────────────────────────────────

function MetricRow({ icon: Icon, label, value, valueClass, iconClass }) {
  return (
    <div className="flex items-center justify-between py-2
      border-b border-gray-50 dark:border-panel-border/30 last:border-0">
      <div className="flex items-center gap-2">
        <div className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0
          ${iconClass || 'bg-gray-100 dark:bg-panel-raised text-gray-400 dark:text-ink-dim'}`}>
          <Icon size={12} strokeWidth={2} />
        </div>
        <span className="text-[11px] text-gray-600 dark:text-ink-dim">{label}</span>
      </div>
      <span className={`text-sm font-mono tnum font-semibold
        ${valueClass || 'text-gray-800 dark:text-ink'}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Real-Time Overview Panel ─────────────────────────────────────────────────

function RealTimeOverview({ stats }) {
  const total    = stats.callsToday?.total    || 0;
  const answered = stats.callsToday?.answered || 0;
  const abnd     = stats.callsToday?.abandoned || 0;
  const ansRate  = total > 0 ? Math.round(answered / total * 100) : 0;
  const abnRate  = total > 0 ? Math.round(abnd / total * 100) : 0;
  const slaPct   = Number(stats.slaPct) || 0;

  return (
    <Panel eyebrow="Live" title="Real-Time Overview">
      <div className="space-y-4">
        {/* Gauge — horizontal layout to use width, not height */}
        <div className="pt-0.5">
          <ServiceLevelGauge pct={slaPct} />
        </div>

        {/* Metrics */}
        <div>
          <MetricRow
            icon={CheckCircle2} label="Answer Rate"
            value={total > 0 ? `${ansRate}%` : '—'}
            valueClass={
              total === 0 ? 'text-gray-300 dark:text-ink-faint/40'
              : ansRate >= 80 ? 'text-emerald-600 dark:text-lamp-ok'
              : ansRate >= 60 ? 'text-amber-500 dark:text-lamp-warn'
              : 'text-red-500 dark:text-lamp-alert'
            }
            iconClass="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          />
          <MetricRow
            icon={PhoneMissed} label="Abandon Rate"
            value={total > 0 ? `${abnRate}%` : '—'}
            valueClass={
              total === 0 ? 'text-gray-300 dark:text-ink-faint/40'
              : abnRate === 0 ? 'text-emerald-600 dark:text-lamp-ok'
              : abnRate <= 10 ? 'text-amber-500 dark:text-lamp-warn'
              : 'text-red-500 dark:text-lamp-alert'
            }
            iconClass="bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400"
          />
          <MetricRow
            icon={Timer} label="Avg Wait"
            value={fmtSeconds(stats.callsToday?.avg_wait_seconds)}
            iconClass="bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400"
          />
          <MetricRow
            icon={Phone} label="Calls Today"
            value={total}
            iconClass="bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
          />
        </div>

        {/* Agent distribution */}
        <div>
          <p className="text-[9px] uppercase tracking-widest font-semibold
            text-gray-400 dark:text-ink-faint mb-2.5">
            Agent Distribution
          </p>
          <AgentStatusDonut agents={stats.agents} />
        </div>
      </div>
    </Panel>
  );
}

// ─── Live Queue Snapshot ──────────────────────────────────────────────────────

function LiveQueueSnapshot({ queueStats }) {
  return (
    <Panel eyebrow="Live" title="Queue Snapshot">
      {(!queueStats || queueStats.length === 0) ? (
        <div className="flex items-center gap-3 py-3 text-gray-400 dark:text-ink-faint">
          <PhoneIncoming size={15} strokeWidth={1.5} className="shrink-0" />
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-ink-dim">All queues clear</p>
            <p className="text-[10px] mt-0.5">No callers waiting</p>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {queueStats.map((q, i) => {
            const waiting = q.waiting || 0;
            const avail   = q.available_agents || 0;
            const longest = fmtSeconds(q.longest_wait_seconds);
            const sla     = Number(q.sla_pct_today) || 0;
            const color   = QUEUE_COLORS[i % QUEUE_COLORS.length];
            const slaColor = sla >= 80 ? 'text-emerald-600 dark:text-lamp-ok'
              : sla >= 60 ? 'text-amber-500 dark:text-lamp-warn'
              : 'text-red-500 dark:text-lamp-alert';

            return (
              <div key={q.queue_name}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border transition-all ${
                  waiting > 0
                    ? 'border-amber-200 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/5'
                    : 'border-gray-100 dark:border-panel-border bg-gray-50/40 dark:bg-panel-raised/20'
                }`}>
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-800 dark:text-ink truncate">
                    {q.display_name || q.queue_name}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-ink-faint font-mono mt-0.5">
                    {avail} avail · {longest}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {waiting > 0 ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full
                      bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400
                      text-[9px] font-bold animate-pulse-soft">
                      {waiting} waiting
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full
                      bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400
                      text-[9px] font-semibold">
                      Clear
                    </span>
                  )}
                  <p className={`text-[9px] font-mono tnum mt-0.5 ${slaColor}`}>SLA {sla}%</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── Agent Roster ─────────────────────────────────────────────────────────────

function AgentRoster({ agents, tick }) {
  const sorted = useMemo(() => {
    const order = { Available: 0, 'On Break': 1, 'Logged Out': 2 };
    return [...(agents || [])].sort((a, b) =>
      (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [agents]);

  return (
    <Panel eyebrow="Roster" title="Agent Status">
      {sorted.length === 0 ? (
        <div className="flex items-center gap-3 py-3 text-gray-400 dark:text-ink-faint">
          <Users size={15} strokeWidth={1.5} className="shrink-0" />
          <p className="text-xs text-gray-500 dark:text-ink-dim">No agents configured</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {sorted.map((a) => {
            const initials = (a.full_name || '??')
              .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
            const dotColor =
              a.status === 'Available' ? '#27C98A' :
              a.status === 'On Break'  ? '#4C8EF5' : '#4C5A78';

            return (
              <div key={a.agent_id}
                className="flex items-center gap-2 py-1.5 px-2 rounded-lg
                  hover:bg-gray-50 dark:hover:bg-panel-raised/50 transition-colors">
                <div className="h-7 w-7 rounded-full flex items-center justify-center
                  shrink-0 text-[10px] font-bold text-white"
                  style={{ background: dotColor + 'CC' }}>
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-gray-800 dark:text-ink truncate">
                    {a.full_name}
                  </p>
                  <p className="text-[10px] font-mono tnum text-gray-400 dark:text-ink-faint leading-none mt-0.5">
                    ext {a.avaya_extension}
                    {a.status === 'Available' && a.status_since && (
                      <span className="text-emerald-500 dark:text-lamp-available ml-1">
                        · {fmtIdle(a.status_since, tick)}
                      </span>
                    )}
                  </p>
                </div>
                <StatusLamp status={a.status} showLabel={false} size="sm" />
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

const ACTIVITY_CFG = {
  'call:enqueued':  { Icon: PhoneIncoming, cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  'call:bridged':   { Icon: PhoneCall,     cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  'call:abandoned': { Icon: PhoneOff,      cls: 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400' },
  'agent:login':    { Icon: UserCheck,     cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  'agent:logout':   { Icon: UserX,         cls: 'bg-gray-100 dark:bg-panel-raised text-gray-500 dark:text-ink-dim' },
  'agent:break':    { Icon: Coffee,        cls: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  'default':        { Icon: Activity,      cls: 'bg-gray-100 dark:bg-panel-raised text-gray-400 dark:text-ink-dim' },
};

function ActivityFeed({ activities }) {
  return (
    <Panel eyebrow="Live" title="Activity Feed">
      {activities.length === 0 ? (
        <div className="flex items-center gap-3 py-3 text-gray-400 dark:text-ink-faint">
          <Radio size={15} strokeWidth={1.5} className="shrink-0" />
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-ink-dim">No recent activity</p>
            <p className="text-[10px] mt-0.5">Events appear here in real time</p>
          </div>
        </div>
      ) : (
        <div className="space-y-0.5 max-h-60 overflow-y-auto">
          {activities.map((act) => {
            const cfg = ACTIVITY_CFG[act.type] || ACTIVITY_CFG['default'];
            const { Icon, cls } = cfg;
            return (
              <div key={act.id}
                className="flex items-start gap-2 py-1.5 px-1 rounded-md
                  hover:bg-gray-50/60 dark:hover:bg-panel-raised/30 transition-colors
                  animate-slide-in-up">
                <div className={`h-6 w-6 rounded-md flex items-center justify-center
                  shrink-0 mt-0.5 ${cls}`}>
                  <Icon size={11} strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-gray-800 dark:text-ink leading-snug">
                    {act.text}
                  </p>
                  {act.detail && (
                    <p className="text-[10px] text-gray-400 dark:text-ink-faint">{act.detail}</p>
                  )}
                </div>
                <span className="text-[9px] text-gray-400 dark:text-ink-faint shrink-0 mt-0.5 tabular-nums">
                  {timeAgo(act.ts)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── Recent Alerts (compact) ──────────────────────────────────────────────────

function RecentAlerts() {
  return (
    <Panel eyebrow="System" title="Recent Alerts">
      <div className="flex items-center gap-3 py-3 text-gray-400 dark:text-ink-faint">
        <Bell size={15} strokeWidth={1.5} className="shrink-0" />
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-ink-dim">No active alerts</p>
          <p className="text-[10px] mt-0.5">All systems operating normally</p>
        </div>
      </div>
    </Panel>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

const MAX_ACTIVITIES = 14;

export default function Dashboard() {
  const [stats,      setStats]      = useState(null);
  const [agents,     setAgents]     = useState([]);
  const [queueStats, setQueueStats] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [tick,       setTick]       = useState(Date.now());
  const [activities, setActivities] = useState([]);
  const actId = useRef(0);

  const addActivity = useCallback((type, text, detail) => {
    setActivities(prev => [
      { id: ++actId.current, type, text, detail, ts: Date.now() },
      ...prev,
    ].slice(0, MAX_ACTIVITIES));
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, a, qs] = await Promise.all([
        Stats.dashboard(),
        AgentsApi.list(),
        Stats.queues(),
      ]);
      setStats(s);
      setAgents(a);
      setQueueStats(qs);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 10_000);
    return () => clearInterval(poll);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Data refresh events (existing behavior preserved) ──────────────────────
  const onRefresh = useCallback(() => load(), [load]);
  useSocketEvent('agent:state',    onRefresh);
  useSocketEvent('agent:status',   onRefresh);
  useSocketEvent('agent:update',   onRefresh);
  useSocketEvent('call:enqueued',  onRefresh);
  useSocketEvent('call:bridged',   onRefresh);
  useSocketEvent('channel:hangup', onRefresh);

  // ── Activity feed handlers (separate — don't re-call load) ────────────────
  const onCallEnqueued = useCallback((payload) => {
    addActivity('call:enqueued', `Call entered ${payload?.queue_name || 'queue'}`,
      payload?.caller_id_number);
  }, [addActivity]);

  const onCallBridged = useCallback((payload) => {
    addActivity('call:bridged', 'Call connected to agent',
      payload?.agent_name || payload?.agent_id);
  }, [addActivity]);

  const onCallAbandoned = useCallback((payload) => {
    addActivity('call:abandoned', `Call abandoned in ${payload?.queue_name || 'queue'}`);
  }, [addActivity]);

  const onAgentChange = useCallback((payload) => {
    const name  = payload?.full_name || payload?.agent_id || 'Agent';
    const state = payload?.state || payload?.status;
    if (!state) return;
    if      (state === 'Available')  addActivity('agent:login',  `${name} is now available`);
    else if (state === 'Logged Out') addActivity('agent:logout', `${name} logged out`);
    else if (state === 'On Break')   addActivity('agent:break',  `${name} went on break`);
  }, [addActivity]);

  useSocketEvent('call:enqueued',  onCallEnqueued);
  useSocketEvent('call:bridged',   onCallBridged);
  useSocketEvent('call:abandoned', onCallAbandoned);
  useSocketEvent('agent:state',    onAgentChange);
  useSocketEvent('agent:status',   onAgentChange);

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <KpiSkeleton count={5} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
          <div className="skeleton h-44 rounded-xl xl:col-span-2" />
          <div className="skeleton h-52 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          <div className="skeleton h-32 rounded-xl" />
          <div className="skeleton h-36 rounded-xl" />
          <div className="skeleton h-28 rounded-xl" />
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Panel title="Dashboard unavailable">
        <div className="flex items-start gap-4 py-3">
          <div className="h-10 w-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center
            justify-center shrink-0">
            <LayoutDashboard size={18} strokeWidth={1.5} className="text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-700 dark:text-ink">
              Could not load dashboard data
            </p>
            <p className="text-xs text-gray-400 dark:text-ink-faint mt-1">{error}</p>
            <button onClick={load} className="btn-secondary gap-1.5 mt-3 text-xs">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        </div>
      </Panel>
    );
  }

  const totalWaiting = (stats.queueSnapshot || []).reduce((s, q) => s + q.waiting, 0);
  const abandoned    = stats.callsToday?.abandoned ?? 0;
  const queueDist    = stats.queueDistribution || [];

  return (
    <div className="space-y-4">

      {/* ── KPI Row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard
          label="Agents Available"
          value={stats.agents?.Available ?? 0}
          tone="green" icon={Users}
          sub={`${stats.agents?.['On Break'] ?? 0} break · ${stats.agents?.['Logged Out'] ?? 0} out`}
        />
        <KpiCard
          label="Calls Waiting"
          value={totalWaiting}
          tone={totalWaiting > 0 ? 'amber' : 'default'} icon={PhoneIncoming}
          sub={totalWaiting > 0 ? 'In queue now' : 'All queues clear'}
        />
        <KpiCard
          label="Calls Today"
          value={stats.callsToday?.total ?? 0}
          tone="blue" icon={Gauge}
          sub={`${stats.callsToday?.answered ?? 0} answered`}
        />
        <KpiCard
          label="Avg Wait"
          value={fmtSeconds(stats.callsToday?.avg_wait_seconds)}
          tone="amber" icon={Timer}
          sub="Average queue wait"
        />
        <KpiCard
          label="Abandoned"
          value={abandoned}
          tone={abandoned > 0 ? 'red' : 'default'} icon={PhoneMissed}
          sub={stats.callsToday?.total > 0
            ? `${Math.round(abandoned / stats.callsToday.total * 100)}% of total`
            : 'No abandoned calls'}
        />
      </div>

      {/*
        ── Unified 3-column grid ─────────────────────────────────────────────
        Real-Time Overview spans BOTH inner rows (xl:row-span-2).
        This means Queue Snapshot starts immediately below Queue Performance
        with no gap — there is no separate grid container between them.

        Layout at xl+:
          col 1-2 row 1 │ col 3 row 1-2
          Queue Perf     │ Real-Time Overview (spans both rows)
          col 1-2 row 2  │
          Snap + Roster  │
      */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Queue Performance: col 1-2, row 1 */}
        <div className="xl:col-span-2">
          <QueuePerformanceSection distribution={queueDist} />
        </div>

        {/* Real-Time Overview: col 3, spans rows 1 AND 2 — fills right column */}
        <div className="xl:row-span-2 xl:row-start-1 xl:col-start-3">
          <RealTimeOverview stats={stats} />
        </div>

        {/* Bottom-left: col 1-2, row 2 — starts directly below Queue Perf */}
        <div className="xl:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <LiveQueueSnapshot queueStats={queueStats} />
          <AgentRoster agents={agents} tick={tick} />
        </div>
      </div>

      {/* ── Activity Feed + Alerts ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className="xl:col-span-2">
          <ActivityFeed activities={activities} />
        </div>
        <RecentAlerts />
      </div>

    </div>
  );
}
