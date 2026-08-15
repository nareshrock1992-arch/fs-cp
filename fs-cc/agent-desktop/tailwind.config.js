/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // All theme-sensitive colors are CSS-variable backed.
      // Light values live in :root, dark values in .dark — defined in index.css.
      // Opacity modifiers (bg-panel-bg/50) work because of the /alpha-value syntax.
      colors: {
        panel: {
          bg:      'rgb(var(--panel-bg)      / <alpha-value>)',
          surface: 'rgb(var(--panel-surface) / <alpha-value>)',
          raised:  'rgb(var(--panel-raised)  / <alpha-value>)',
          border:  'rgb(var(--panel-border)  / <alpha-value>)',
          accent:  'rgb(var(--panel-accent)  / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink)       / <alpha-value>)',
          dim:     'rgb(var(--ink-dim)   / <alpha-value>)',
          faint:   'rgb(var(--ink-faint) / <alpha-value>)',
        },
        // Lamp / status colours are the same in both themes
        lamp: {
          live:      '#F5A623',
          available: '#27C98A',
          break:     '#4C8EF5',
          loggedout: '#4C5A78',
          alert:     '#EF4444',
        },
        brand: {
          DEFAULT: '#2563EB',
          dim:     '#1E4FB5',
          light:   '#60A5FA',
        },
      },
      fontFamily: {
        display: ['"IBM Plex Sans Condensed"', 'ui-sans-serif', 'sans-serif'],
        sans:    ['Inter', 'ui-sans-serif', 'sans-serif'],
        mono:    ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card:          '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
        'card-dark':   '0 1px 3px rgba(0,0,0,0.50), 0 1px 2px rgba(0,0,0,0.60)',
        'card-hover':  '0 4px 12px rgba(0,0,0,0.12)',
        'lamp-green':  '0 0 8px 2px rgba(39,201,138,0.4)',
        'lamp-amber':  '0 0 8px 2px rgba(245,166,35,0.4)',
        'lamp-red':    '0 0 8px 2px rgba(239,68,68,0.4)',
        'lamp-blue':   '0 0 8px 2px rgba(76,142,245,0.4)',
      },
      borderRadius: {
        sm:      '3px',
        DEFAULT: '6px',
        lg:      '10px',
        xl:      '14px',
      },
    },
  },
  plugins: [],
};
