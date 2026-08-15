const TONE = {
  default: {
    circle: 'bg-gray-100 dark:bg-slate-700/60 text-gray-500 dark:text-slate-300',
    value:  'text-gray-900 dark:text-ink',
    card:   '',
  },
  green: {
    circle: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    value:  'text-emerald-600 dark:text-emerald-400',
    card:   '',
  },
  amber: {
    circle: 'bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400',
    value:  'text-amber-600 dark:text-amber-400',
    card:   '',
  },
  red: {
    circle: 'bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400',
    value:  'text-red-600 dark:text-red-400',
    card:   '',
  },
  blue: {
    circle: 'bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400',
    value:  'text-blue-600 dark:text-blue-400',
    card:   '',
  },
  purple: {
    circle: 'bg-violet-50 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400',
    value:  'text-violet-600 dark:text-violet-400',
    card:   '',
  },
};

const ACCENT = {
  default: '',
  green:   'bg-emerald-500/60',
  amber:   'bg-amber-500/60',
  red:     'bg-red-500/60',
  blue:    'bg-blue-500/60',
  purple:  'bg-violet-500/60',
};

export default function KpiCard({ label, value, suffix, tone = 'default', icon: Icon, sub, trend }) {
  const t = TONE[tone] ?? TONE.default;
  const accent = ACCENT[tone] ?? '';

  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 dark:border-panel-border
                    bg-white dark:bg-panel-surface shadow-card p-5 flex items-center gap-4">

      {/* Icon circle */}
      {Icon && (
        <div className={`shrink-0 h-11 w-11 rounded-xl flex items-center justify-center ${t.circle}`}>
          <Icon size={20} strokeWidth={1.75} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-widest font-semibold
                      text-gray-400 dark:text-ink-faint mb-0.5 truncate">
          {label}
        </p>
        <p className={`font-mono tnum text-2xl font-bold leading-none ${t.value}`}>
          {value}
          {suffix && <span className="text-sm ml-1 font-normal opacity-60">{suffix}</span>}
        </p>
        {sub && (
          <p className="text-[11px] text-gray-400 dark:text-ink-faint mt-1 truncate">{sub}</p>
        )}
        {trend && (
          <p className="text-[11px] text-gray-400 dark:text-ink-faint mt-1 truncate">{trend}</p>
        )}
      </div>

      {/* Accent stripe — right edge */}
      {accent && (
        <div className={`absolute right-0 top-2 bottom-2 w-[3px] rounded-full ${accent}`} />
      )}
    </div>
  );
}
