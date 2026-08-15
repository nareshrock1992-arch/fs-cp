import { useState, useEffect, useRef } from 'react';
import { PhoneIncoming, PhoneCall } from 'lucide-react';

function useElapsed(startedAt) {
  const [elapsed, setElapsed] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    if (!startedAt) { setElapsed(0); return; }
    const tick = () =>
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    tick();
    ref.current = setInterval(tick, 1000);
    return () => clearInterval(ref.current);
  }, [startedAt]);

  return elapsed;
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// callState: { phase: 'ringing'|'talking'|null, callUuid, ani, queueName, startedAt }
export default function LiveCallPanel({ callState }) {
  const elapsed = useElapsed(callState?.startedAt);

  if (!callState || callState.phase === null) return null;

  const isRinging = callState.phase === 'ringing';

  const borderClass = isRinging
    ? 'border-lamp-live animate-ring-pulse'
    : 'border-lamp-available';

  const accentClass = isRinging ? 'bg-lamp-live' : 'bg-lamp-available';
  const iconBgClass = isRinging ? 'bg-lamp-live/15' : 'bg-lamp-available/15';
  const iconColor   = isRinging ? 'text-lamp-live' : 'text-lamp-available';
  const labelColor  = isRinging ? 'text-lamp-live' : 'text-lamp-available';
  const labelText   = isRinging ? 'Incoming Call' : 'In Call';

  return (
    <div className={`card border-2 ${borderClass} relative overflow-hidden`}>
      {/* Accent stripe */}
      <div className={`absolute left-0 inset-y-0 w-1 ${accentClass}`} />

      <div className="flex items-center gap-4 p-4 pl-5">
        {/* Icon */}
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${iconBgClass}`}>
          {isRinging
            ? <PhoneIncoming size={22} className={`${iconColor} ${isRinging ? 'animate-pulse-soft' : ''}`} />
            : <PhoneCall     size={22} className={iconColor} />}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[11px] font-bold uppercase tracking-wider ${labelColor}`}>
              {labelText}
            </span>
            {!isRinging && (
              <span className="font-mono text-ink tabular-nums font-semibold text-sm">
                {formatDuration(elapsed)}
              </span>
            )}
          </div>
          <p className="text-ink font-semibold text-lg truncate">
            {callState.ani || 'Unknown caller'}
          </p>
          {callState.queueName && (
            <p className="text-ink-dim text-sm">
              Queue: <span className="text-brand-light font-medium">{callState.queueName}</span>
            </p>
          )}
        </div>

        {/* Ringing timer */}
        {isRinging && (
          <div className="shrink-0 text-right">
            <p className="stat-label">Ringing</p>
            <p className="font-mono text-lamp-live font-bold text-xl tnum">{formatDuration(elapsed)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
