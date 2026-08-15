/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Surface palette — dark values; light values defined in index.css ────
        panel: {
          bg:      '#060B17',   // page background
          surface: '#0B1220',   // card / sidebar
          raised:  '#111B2E',   // elevated panels, table headers
          border:  '#1C2A42',   // visible but subtle borders
          accent:  '#1E3A6E',   // blue accent / active indicator
        },
        ink: {
          DEFAULT: '#E8ECF6',   // primary text
          dim:     '#8B99B8',   // secondary text
          faint:   '#4C5A78',   // placeholders, disabled
        },
        lamp: {
          live:      '#F5A623',   // amber — ringing / waiting
          available: '#27C98A',   // green — available
          break:     '#4C8EF5',   // blue — on break
          loggedout: '#4C5A78',   // muted — logged out
          alert:     '#EF4444',   // red — abandoned / error
          ok:        '#27C98A',   // alias → available (SLA OK)
          warn:      '#F5A623',   // alias → live (SLA warn)
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
        card:        '0 1px 4px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
        'card-dark': '0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.6)',
        'card-hover':'0 4px 16px rgba(0,0,0,0.12)',
        lamp:        '0 0 0 3px rgba(245,166,35,0.15)',
        'lamp-green':'0 0 8px 2px rgba(39,201,138,0.45)',
        'lamp-amber':'0 0 8px 2px rgba(245,166,35,0.45)',
        'lamp-red':  '0 0 8px 2px rgba(239,68,68,0.45)',
        'lamp-blue': '0 0 8px 2px rgba(76,142,245,0.45)',
      },
      borderRadius: {
        sm:      '4px',
        DEFAULT: '8px',
        lg:      '10px',
        xl:      '12px',
        '2xl':   '16px',
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'ring-pulse': 'ring-pulse 1.5s ease-out infinite',
        'slide-in-up':'slide-in-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
