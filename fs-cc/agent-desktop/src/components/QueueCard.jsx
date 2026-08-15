import { Users } from 'lucide-react';

function fmt(seconds) {
  if (!seconds) return '0s';
  if (seconds < 60)  return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function SlaBar({ pct }) {
  const n   = Number(pct) || 0;
  const col = n >= 90 ? 'bg-lamp-available' : n >= 70 ? 'bg-lamp-live' : 'bg-lamp-alert';
  const textCol = n >= 90 ? 'text-lamp-available' : n >= 70 ? 'text-lamp-live' : 'text-lamp-alert';
  return (
    <div className="mt-1">
      <div className="flex justify-between text-[10px] text-ink-faint mb-1">
        <span>SLA</span>
        <span className={textCol}>{n}%</span>
      </div>
      <div className="h-1 rounded-full bg-panel-raised overflow-hidden">
        <div className={`h-full rounded-full transition-all ${col}`} style={{ width: `${Math.min(100, n)}%` }} />
      </div>
    </div>
  );
}

export default function QueueCard({ q }) {
  const strategyLabel = (q.strategy || '').replace(/-/g, ' ');

  return (
    <div className="card p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-ink leading-tight">{q.display_name}</h3>
          <p className="text-[11px] text-ink-faint mt-0.5">{q.name}</p>
        </div>
        <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full
                         bg-panel-raised border border-panel-border text-ink-dim capitalize">
          {strategyLabel}
        </span>
      </div>

      {/* Live row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-panel-raised rounded-lg p-2.5 text-center">
          <p className="stat-label">Waiting</p>
          <p className={`stat-value mt-0.5 ${q.waiting > 0 ? 'text-lamp-live' : 'text-ink-dim'}`}>
            {q.waiting}
          </p>
        </div>
        <div className="bg-panel-raised rounded-lg p-2.5 text-center">
          <p className="stat-label">In Call</p>
          <p className={`stat-value mt-0.5 ${q.active > 0 ? 'text-lamp-available' : 'text-ink-dim'}`}>
            {q.active}
          </p>
        </div>
      </div>

      {/* Agent availability */}
      <div className="flex items-center gap-2 text-xs">
        <Users size={12} className="text-ink-faint shrink-0" />
        <span className="flex items-center gap-1 text-lamp-available">
          <span className="w-1.5 h-1.5 rounded-full bg-lamp-available" />
          {q.available_agents ?? 0} avail
        </span>
        <span className="flex items-center gap-1 text-lamp-break">
          <span className="w-1.5 h-1.5 rounded-full bg-lamp-break" />
          {q.on_break_agents ?? 0} break
        </span>
        <span className="flex items-center gap-1 text-ink-faint">
          <span className="w-1.5 h-1.5 rounded-full bg-ink-faint" />
          {q.logged_out_agents ?? 0} out
        </span>
      </div>

      {/* Today stats */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-2">
        <Stat label="Offered"   value={q.offered_today}   />
        <Stat label="Answered"  value={q.answered_today}  color="text-lamp-available" />
        <Stat label="Abandoned" value={q.abandoned_today}
              color={q.abandoned_today > 0 ? 'text-lamp-alert' : undefined} />
        <Stat label="Avg Wait"  value={fmt(q.avg_wait_today)} />
        <Stat label="Longest"   value={fmt(q.longest_wait_seconds)} />
        <Stat label="Max Wait"  value={fmt(q.max_wait_time)} />
      </div>

      <SlaBar pct={q.sla_pct_today} />
    </div>
  );
}

function Stat({ label, value, color = 'text-ink' }) {
  return (
    <div>
      <p className="stat-label">{label}</p>
      <p className={`font-semibold text-sm tabular-nums mt-0.5 ${color}`}>{value ?? '—'}</p>
    </div>
  );
}
