/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // OmniAlert-inspired deep navy dark palette
        panel: {
          bg:      '#060B17',   // near-black navy (body)
          surface: '#0B1220',   // card / sidebar surface
          raised:  '#111B2E',   // elevated panels, hover states
          border:  '#1C2A42',   // borders – visible but subtle
          accent:  '#1E3A6E',   // blue accent border / active indicator
        },
        ink: {
          DEFAULT: '#E8ECF6',   // primary text
          dim:     '#8B99B8',   // secondary text
          faint:   '#4C5A78',   // placeholders, disabled
        },
        lamp: {
          live:      '#F5A623',   // amber – ringing / waiting
          available: '#27C98A',   // green – available agent
          break:     '#4C8EF5',   // blue – on break
          loggedout: '#4C5A78',   // muted – logged out
          alert:     '#EF4444',   // red – abandoned / error
          ok:        '#27C98A',   // alias for available (SLA OK)
          warn:      '#F5A623',   // alias for live (SLA warn)
        },
        // OmniAlert blue accent for interactive elements
        brand: {
          DEFAULT: '#2563EB',
          dim:     '#1E4FB5',
          light:   '#60A5FA',
        }
      },
      fontFamily: {
        display: ['"IBM Plex Sans Condensed"', 'ui-sans-serif', 'sans-serif'],
        sans:    ['Inter', 'ui-sans-serif', 'sans-serif'],
        mono:    ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card:       '0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.6)',
        'card-hover':'0 4px 12px rgba(0,0,0,0.6)',
        lamp:       '0 0 0 3px rgba(245,166,35,0.15)',
        'lamp-green':'0 0 8px 2px rgba(39,201,138,0.45)',
        'lamp-amber':'0 0 8px 2px rgba(245,166,35,0.45)',
        'lamp-red':  '0 0 8px 2px rgba(239,68,68,0.45)',
        'lamp-blue': '0 0 8px 2px rgba(76,142,245,0.45)',
      },
      borderRadius: {
        sm:      '3px',
        DEFAULT: '6px',
        lg:      '10px',
        xl:      '14px',
      },
    }
  },
  plugins: []
};
