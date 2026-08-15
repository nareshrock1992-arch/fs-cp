export function FormField({ label, hint, children, required }) {
  return (
    <label className="block mb-4">
      <span className="block text-[11px] font-semibold text-gray-500 dark:text-ink-faint
                       uppercase tracking-wider mb-1.5">
        {label}{required && <span className="text-lamp-alert ml-0.5">*</span>}
      </span>
      {children}
      {hint && (
        <span className="block text-[11px] text-gray-400 dark:text-ink-faint mt-1">{hint}</span>
      )}
    </label>
  );
}

// Canonical input class — uses brand-blue focus ring (was lamp-live/amber before)
export const inputClass =
  'field-input';

export const buttonPrimary =
  'btn-primary';

export const buttonSecondary =
  'btn-secondary';

export const buttonDanger =
  'btn-danger';
