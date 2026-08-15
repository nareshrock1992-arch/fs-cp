import { useState } from 'react';
import { Check, Coffee, LogOut, Loader2 } from 'lucide-react';
import { api } from '../api/client.js';

const STATUSES = [
  {
    value:   'Available',
    label:   'Available',
    Icon:    Check,
    color:   'text-lamp-available',
    bg:      'bg-lamp-available/10 border-lamp-available/30 hover:bg-lamp-available/20',
    bgActive:'bg-lamp-available/20 border-lamp-available shadow-lamp-green',
    dot:     'bg-lamp-available shadow-lamp-green',
  },
  {
    value:   'On Break',
    label:   'On Break',
    Icon:    Coffee,
    color:   'text-lamp-break',
    bg:      'bg-lamp-break/10 border-lamp-break/30 hover:bg-lamp-break/20',
    bgActive:'bg-lamp-break/20 border-lamp-break shadow-lamp-blue',
    dot:     'bg-lamp-break shadow-lamp-blue',
  },
  {
    value:   'Logged Out',
    label:   'Log Out',
    Icon:    LogOut,
    color:   'text-ink-faint',
    bg:      'bg-panel-raised border-panel-border hover:bg-panel-border/60',
    bgActive:'bg-panel-raised border-panel-accent',
    dot:     'bg-ink-faint',
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
        {STATUSES.map(({ value, label, Icon, color, bg, bgActive, dot }) => {
          const active  = currentStatus === value;
          const loading = changing === value;
          return (
            <button
              key={value}
              onClick={() => handleClick(value)}
              disabled={!!changing}
              aria-pressed={active}
              className={`
                btn border text-sm font-semibold transition-all
                ${active ? `${bgActive} ${color}` : `${bg} text-ink-dim`}
                disabled:opacity-60
              `}
            >
              {loading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <>
                  {active && <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />}
                  <Icon size={15} />
                </>
              )}
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
