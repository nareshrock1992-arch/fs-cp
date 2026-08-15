import { Sun, Moon } from 'lucide-react';

// Sun icon = currently dark, click to go light.
// Moon icon = currently light, click to go dark.
export default function ThemeToggle({ isDark, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle colour scheme"
      className="p-2 rounded-lg text-ink-faint hover:text-ink-dim
                 hover:bg-panel-raised transition-colors"
    >
      {isDark
        ? <Sun  size={16} strokeWidth={1.75} />
        : <Moon size={16} strokeWidth={1.75} />}
    </button>
  );
}
