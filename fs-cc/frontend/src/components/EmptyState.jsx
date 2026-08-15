export default function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
      {Icon && (
        <div className="h-12 w-12 rounded-xl flex items-center justify-center
                        bg-gray-100 dark:bg-panel-raised
                        text-gray-300 dark:text-ink-faint/60 mb-2 shrink-0">
          <Icon size={24} strokeWidth={1.25} />
        </div>
      )}
      {title && (
        <p className="text-sm font-semibold text-gray-500 dark:text-ink-dim">{title}</p>
      )}
      {body && (
        <p className="text-xs text-gray-400 dark:text-ink-faint max-w-xs leading-relaxed mt-0.5">{body}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
