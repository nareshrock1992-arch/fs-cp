export function FormField({ label, hint, children }) {
  return (
    <label className="block mb-4">
      <span className="block text-xs font-medium dark:text-ink-dim text-gray-600 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] dark:text-ink-faint text-gray-400 mt-1">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-sm border dark:border-panel-border border-gray-300 dark:bg-panel-bg bg-white px-3 py-2 text-sm dark:text-ink text-gray-900 dark:placeholder:text-ink-faint placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-lamp-live/40 focus:border-lamp-live/60 transition-colors';

export const buttonPrimary =
  'inline-flex items-center justify-center gap-2 rounded bg-brand text-white text-sm font-semibold px-4 py-2 hover:bg-brand-dim active:brightness-95 transition-all shadow-lamp-blue disabled:opacity-50 disabled:pointer-events-none';

export const buttonSecondary =
  'inline-flex items-center justify-center gap-2 rounded-sm border dark:border-panel-border border-gray-300 dark:bg-panel-raised bg-gray-50 dark:text-ink text-gray-700 text-sm font-medium px-4 py-2 hover:bg-gray-100 dark:hover:bg-panel-border/60 transition-colors disabled:opacity-50 disabled:pointer-events-none';

export const buttonDanger =
  'inline-flex items-center justify-center gap-2 rounded-sm border border-lamp-alert/40 text-lamp-alert text-sm font-medium px-4 py-2 hover:bg-lamp-alert/10 transition-colors disabled:opacity-50 disabled:pointer-events-none';
