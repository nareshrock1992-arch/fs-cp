export default function LoadingState({ rows = 3, cols = 4, label = 'Loading…' }) {
  return (
    <div role="status" aria-label={label}>
      {/* Skeleton rows */}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-3">
            {Array.from({ length: cols }).map((_, j) => (
              <div
                key={j}
                className="skeleton h-8 flex-1"
                style={{ opacity: 1 - i * 0.15 }}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 dark:text-ink-faint mt-4 text-center">{label}</p>
    </div>
  );
}

export function KpiSkeleton({ count = 5 }) {
  return (
    <div className={`grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-${count}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-gray-200 dark:border-panel-border
                                bg-white dark:bg-panel-surface p-5 flex items-center gap-4">
          <div className="skeleton h-11 w-11 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-2.5 w-16 rounded" />
            <div className="skeleton h-7 w-12 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
