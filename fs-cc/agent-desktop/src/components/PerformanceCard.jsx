import { Phone, PhoneMissed, Clock, Timer } from 'lucide-react';

function fmt(sec) {
  if (!sec) return '0s';
  if (sec < 60)  return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtHm(sec) {
  if (!sec) return '0m';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function PerformanceCard({ perf, loading }) {
  if (loading) {
    return (
      <div className="card p-4">
        <p className="stat-label mb-3">My Performance Today</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-panel-raised rounded-lg p-2.5 animate-pulse h-14" />
          ))}
        </div>
      </div>
    );
  }

  if (!perf) return null;

  const statusLog = perf.status_log || [];
  const available = statusLog.find(r => r.status === 'Available')?.transitions ?? 0;
  const onBreak   = statusLog.find(r => r.status === 'On Break')?.transitions   ?? 0;

  return (
    <div className="card p-4">
      <p className="stat-label mb-3">My Performance Today</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <KpiTile
          label="Handled"
          value={perf.calls_handled ?? 0}
          color={perf.calls_handled > 0 ? 'text-lamp-available' : 'text-ink-dim'}
          Icon={Phone}
          iconColor={perf.calls_handled > 0 ? 'text-lamp-available' : 'text-ink-faint'}
        />
        <KpiTile
          label="Missed"
          value={perf.calls_missed ?? 0}
          color={perf.calls_missed > 0 ? 'text-lamp-alert' : 'text-ink-dim'}
          Icon={PhoneMissed}
          iconColor={perf.calls_missed > 0 ? 'text-lamp-alert' : 'text-ink-faint'}
        />
        <KpiTile
          label="Avg Talk"
          value={fmt(perf.avg_talk_seconds)}
          Icon={Clock}
          iconColor="text-ink-faint"
        />
        <KpiTile
          label="Total Talk"
          value={fmtHm(perf.total_talk_seconds)}
          color="text-brand-light"
          Icon={Timer}
          iconColor="text-brand-light"
        />
      </div>

      {statusLog.length > 0 && (
        <div className="border-t border-panel-border pt-3 flex flex-wrap gap-3">
          <span className="stat-label self-center">Status changes:</span>
          {available > 0 && (
            <Chip color="text-lamp-available bg-lamp-available/10 border-lamp-available/30">
              {available}× Available
            </Chip>
          )}
          {onBreak > 0 && (
            <Chip color="text-lamp-break bg-lamp-break/10 border-lamp-break/30">
              {onBreak}× On Break
            </Chip>
          )}
        </div>
      )}
    </div>
  );
}

function KpiTile({ label, value, color = 'text-ink', Icon, iconColor = 'text-ink-faint' }) {
  return (
    <div className="bg-panel-raised rounded-lg p-2.5 text-center">
      {Icon && <Icon size={14} className={`mx-auto mb-0.5 ${iconColor}`} />}
      <p className="stat-label">{label}</p>
      <p className={`font-bold text-lg tabular-nums mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function Chip({ children, color }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${color}`}>
      {children}
    </span>
  );
}
