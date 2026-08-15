export default function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
      {Icon && (
        <div className="h-14 w-14 rounded-2xl flex items-center justify-center
                        bg-gray-100 dark:bg-panel-raised text-gray-400 dark:text-ink-faint mb-1">
          <Icon size={28} strokeWidth={1.5} />
        </div>
      )}
      {title && (
        <p className="text-sm font-semibold text-gray-600 dark:text-ink-dim">{title}</p>
      )}
      {body && (
        <p className="text-sm text-gray-400 dark:text-ink-faint max-w-xs leading-relaxed">{body}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
