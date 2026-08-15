import { X } from 'lucide-react';

export default function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border dark:border-panel-border border-gray-200 dark:bg-panel-surface bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b dark:border-panel-border border-gray-100">
          <h3 className="font-display font-semibold text-sm tracking-wide dark:text-ink text-gray-800">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="dark:text-ink-faint text-gray-400 hover:text-gray-700 dark:hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t dark:border-panel-border border-gray-100 flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
