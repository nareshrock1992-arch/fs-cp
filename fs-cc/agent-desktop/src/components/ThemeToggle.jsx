// Sun icon = light mode active; Moon icon = dark mode active.
export default function ThemeToggle({ isDark, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle colour scheme"
      className="p-2 rounded-lg text-ink-faint hover:text-ink-dim
                 hover:bg-panel-raised transition-colors"
    >
      {isDark ? (
        /* Sun */
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707
               M6.343 17.657l-.707.707m12.728 0l-.707-.707
               M6.343 6.343l-.707-.707M12 7a5 5 0 100 10 5 5 0 000-10z" />
        </svg>
      ) : (
        /* Moon */
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}
