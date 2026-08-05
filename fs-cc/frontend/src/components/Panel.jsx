export default function Panel({ title, eyebrow, action, children, className = '' }) {
  return (
    <section className={`
      rounded-lg border shadow-card
      dark:bg-panel-surface dark:border-panel-border
      bg-white border-gray-200
      ${className}
    `}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-3.5
          border-b dark:border-panel-border border-gray-100">
          <div>
            {eyebrow && (
              <p className="text-[9px] uppercase tracking-[0.12em] font-bold
                dark:text-brand-light text-blue-500 font-display mb-0.5">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="font-display font-semibold text-sm tracking-wide
                dark:text-ink text-gray-900">
                {title}
              </h2>
            )}
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
