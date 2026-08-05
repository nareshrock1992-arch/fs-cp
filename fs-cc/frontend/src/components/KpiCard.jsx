// OmniAlert-inspired KPI card:
//   • Colored circle icon on the left
//   • Large bold value
//   • Muted label + optional sub-text
const TONE = {
  default: {
    circle:  'bg-slate-700/60 text-slate-300',
    value:   'dark:text-ink   text-gray-900',
    light:   'bg-white border-gray-200',
  },
  green: {
    circle:  'bg-emerald-500/15 text-emerald-400',
    value:   'text-emerald-500 dark:text-emerald-400',
    light:   'bg-green-50 border-green-200',
  },
  amber: {
    circle:  'bg-amber-500/15 text-amber-400',
    value:   'text-amber-500 dark:text-amber-400',
    light:   'bg-amber-50 border-amber-200',
  },
  red: {
    circle:  'bg-red-500/15 text-red-400',
    value:   'text-red-500 dark:text-red-400',
    light:   'bg-red-50 border-red-200',
  },
  blue: {
    circle:  'bg-blue-500/15 text-blue-400',
    value:   'text-blue-500 dark:text-blue-400',
    light:   'bg-blue-50 border-blue-200',
  },
};

export default function KpiCard({ label, value, suffix, tone = 'default', icon: Icon, sub }) {
  const t = TONE[tone] ?? TONE.default;

  return (
    <div className={`
      relative overflow-hidden rounded-lg border
      dark:bg-panel-surface dark:border-panel-border shadow-card
      ${t.light}
      p-4 flex items-center gap-4
    `}>
      {/* Colored icon circle */}
      {Icon && (
        <div className={`shrink-0 h-11 w-11 rounded-lg flex items-center justify-center ${t.circle}`}>
          <Icon size={20} strokeWidth={1.75} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-widest font-display font-semibold
          dark:text-ink-faint text-gray-400 mb-0.5 truncate">
          {label}
        </p>
        <p className={`font-mono tnum text-2xl font-bold leading-none ${t.value}`}>
          {value}
          {suffix && <span className="text-sm ml-1 font-normal opacity-60">{suffix}</span>}
        </p>
        {sub && (
          <p className="text-[11px] dark:text-ink-faint text-gray-400 mt-1 truncate">{sub}</p>
        )}
      </div>

      {/* Subtle accent stripe on the right edge */}
      <div className={`absolute right-0 top-0 bottom-0 w-0.5 rounded-r
        ${tone === 'green' ? 'bg-emerald-500/50'
        : tone === 'amber' ? 'bg-amber-500/50'
        : tone === 'red'   ? 'bg-red-500/50'
        : tone === 'blue'  ? 'bg-blue-500/50'
        : 'bg-transparent'}`}
      />
    </div>
  );
}
