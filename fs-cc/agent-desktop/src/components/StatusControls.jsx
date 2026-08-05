import { useState } from 'react';
import { api } from '../api/client.js';

const STATUSES = [
  {
    value: 'Available',
    label: 'Available',
    color:   'text-lamp-available',
    bg:      'bg-lamp-available/15 border-lamp-available/40 hover:bg-lamp-available/25',
    bgActive:'bg-lamp-available/20 border-lamp-available shadow-lamp-green',
    dot:     'bg-lamp-available shadow-lamp-green',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  {
    value: 'On Break',
    label: 'On Break',
    color:   'text-lamp-break',
    bg:      'bg-lamp-break/15 border-lamp-break/40 hover:bg-lamp-break/25',
    bgActive:'bg-lamp-break/20 border-lamp-break shadow-lamp-blue',
    dot:     'bg-lamp-break shadow-lamp-blue',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M10 9v6m4-6v6M9 3h6l1 3H8l1-3zM5 21h14" />
      </svg>
    ),
  },
  {
    value: 'Logged Out',
    label: 'Log Out',
    color:   'text-ink-faint',
    bg:      'bg-panel-raised border-panel-border hover:bg-panel-raised/60',
    bgActive:'bg-panel-raised border-panel-accent',
    dot:     'bg-ink-faint',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
    ),
  },
];

export default function StatusControls({ currentStatus, onStatusChange }) {
  const [changing, setChanging] = useState(null);

  async function handleClick(value) {
    if (value === currentStatus || changing) return;
    setChanging(value);
    try {
      await api.setStatus(value);
      onStatusChange(value);
    } catch (err) {
      console.error('[status]', err.message);
    } finally {
      setChanging(null);
    }
  }

  return (
    <div className="card p-4">
      <p className="stat-label mb-3">Your Status</p>
      <div className="flex flex-wrap gap-2">
        {STATUSES.map(s => {
          const active  = currentStatus === s.value;
          const loading = changing === s.value;
          return (
            <button
              key={s.value}
              onClick={() => handleClick(s.value)}
              disabled={!!changing}
              className={`
                btn border text-sm font-semibold transition-all
                ${active ? `${s.bgActive} ${s.color}` : `${s.bg} text-ink-dim`}
                disabled:opacity-60
              `}
            >
              {loading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
              ) : (
                <>
                  {active && (
                    <span className={`w-2 h-2 rounded-full ${s.dot} shrink-0`} />
                  )}
                  {s.icon}
                </>
              )}
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
