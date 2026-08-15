export default function Panel({ title, eyebrow, action, children, className = '', noPad = false }) {
  return (
    <section className={`
      rounded-xl border shadow-card
      bg-white dark:bg-panel-surface
      border-gray-200 dark:border-panel-border
      ${className}
    `}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-4
          border-b border-gray-100 dark:border-panel-border">
          <div>
            {eyebrow && (
              <p className="text-[9px] uppercase tracking-[0.12em] font-bold
                text-brand dark:text-brand-light font-display mb-0.5">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="font-display font-semibold text-sm tracking-wide
                text-gray-900 dark:text-ink">
                {title}
              </h2>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={noPad ? '' : 'p-5'}>{children}</div>
    </section>
  );
}
