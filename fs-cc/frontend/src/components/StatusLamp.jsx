const LAMP_MAP = {
  Available:        { color: 'bg-lamp-available', glow: 'shadow-lamp-green', pulse: false,
                      text: 'text-emerald-600 dark:text-lamp-available',
                      badge: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20',
                      label: 'Available' },
  'On Break':       { color: 'bg-lamp-break', glow: 'shadow-lamp-blue', pulse: false,
                      text: 'text-blue-600 dark:text-lamp-break',
                      badge: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20',
                      label: 'On Break' },
  'Logged Out':     { color: 'bg-lamp-loggedout', glow: '', pulse: false,
                      text: 'text-gray-500 dark:text-ink-dim',
                      badge: 'bg-gray-100 dark:bg-panel-raised border-gray-200 dark:border-panel-border',
                      label: 'Logged Out' },
  Receiving:        { color: 'bg-lamp-live', glow: 'shadow-lamp-amber', pulse: true,
                      text: 'text-amber-600 dark:text-lamp-live',
                      badge: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20',
                      label: 'Ringing' },
  'In a queue call':{ color: 'bg-lamp-live', glow: 'shadow-lamp-amber', pulse: true,
                      text: 'text-amber-600 dark:text-lamp-live',
                      badge: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20',
                      label: 'In Call' },
  InQueue:          { color: 'bg-lamp-live', glow: 'shadow-lamp-amber', pulse: true,
                      text: 'text-amber-600 dark:text-lamp-live',
                      badge: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20',
                      label: 'In Queue' },
  Waiting:          { color: 'bg-lamp-available', glow: 'shadow-lamp-green', pulse: false,
                      text: 'text-emerald-600 dark:text-lamp-available',
                      badge: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20',
                      label: 'Waiting' },
  Abandoned:        { color: 'bg-lamp-alert', glow: 'shadow-lamp-red', pulse: false,
                      text: 'text-red-600 dark:text-lamp-alert',
                      badge: 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20',
                      label: 'Abandoned' },
  Offline:          { color: 'bg-lamp-alert', glow: '', pulse: false,
                      text: 'text-red-600 dark:text-lamp-alert',
                      badge: 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20',
                      label: 'Offline' },
};

const FALLBACK = {
  color: 'bg-gray-400 dark:bg-ink-faint', glow: '', pulse: false,
  text: 'text-gray-500 dark:text-ink-dim',
  badge: 'bg-gray-100 dark:bg-panel-raised border-gray-200 dark:border-panel-border',
  label: '',
};

const DOT_SIZE = { sm: 'h-2 w-2', md: 'h-2.5 w-2.5', lg: 'h-3 w-3' };

// lamp — classic dot + text inline
// badge — pill badge with background (for tables, cards)
export default function StatusLamp({ status, label, size = 'md', showLabel = true, variant = 'lamp' }) {
  const cfg = LAMP_MAP[status] || { ...FALLBACK, label: status || 'Unknown' };
  const displayLabel = label || cfg.label;

  if (variant === 'badge') {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
        text-[11px] font-semibold border ${cfg.badge} ${cfg.text}`}>
        <span
          className={`rounded-full h-1.5 w-1.5 shrink-0 ${cfg.color}
            ${cfg.pulse ? 'animate-pulse-soft' : ''}`}
          aria-hidden="true"
        />
        {displayLabel}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`rounded-full shrink-0 ${DOT_SIZE[size] ?? DOT_SIZE.md}
          ${cfg.color} ${cfg.glow} ${cfg.pulse ? 'animate-pulse-soft' : ''}`}
        aria-hidden="true"
      />
      {showLabel && (
        <span className={`text-xs font-semibold tracking-wide ${cfg.text}`}>
          {displayLabel}
        </span>
      )}
    </span>
  );
}
