import { useState, useEffect, useRef } from 'react';

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
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// callState: { phase: 'ringing'|'talking'|null, callUuid, ani, queueName, startedAt }
export default function LiveCallPanel({ callState }) {
  const elapsed = useElapsed(callState?.startedAt);

  if (!callState || callState.phase === null) return null;

  const isRinging = callState.phase === 'ringing';
  const isTalking = callState.phase === 'talking';

  return (
    <div className={`
      card border-2 p-4
      ${isRinging ? 'border-lamp-live animate-pulse' : 'border-lamp-available'}
      relative overflow-hidden
    `}>
      {/* accent stripe */}
      <div className={`absolute left-0 inset-y-0 w-1 ${isRinging ? 'bg-lamp-live' : 'bg-lamp-available'}`} />

      <div className="flex items-center gap-4 pl-3">
        {/* Icon */}
        <div className={`
          w-12 h-12 rounded-full flex items-center justify-center shrink-0
          ${isRinging ? 'bg-lamp-live/15' : 'bg-lamp-available/15'}
        `}>
          {isRinging ? (
            <svg className="w-6 h-6 text-lamp-live" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-lamp-available" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold uppercase tracking-wider ${isRinging ? 'text-lamp-live' : 'text-lamp-available'}`}>
              {isRinging ? '● Incoming Call' : '● In Call'}
            </span>
            {isTalking && (
              <span className="font-mono text-ink tabular-nums font-semibold text-sm">
                {formatDuration(elapsed)}
              </span>
            )}
          </div>
          <p className="text-ink font-semibold text-lg truncate mt-0.5">
            {callState.ani || 'Unknown caller'}
          </p>
          <p className="text-ink-dim text-sm">
            Queue: <span className="text-brand-light">{callState.queueName || '—'}</span>
          </p>
        </div>

        {/* Position / wait indicator for ringing */}
        {isRinging && (
          <div className="shrink-0 text-right">
            <p className="stat-label">Ringing</p>
            <p className="font-mono text-lamp-live font-bold text-lg">{formatDuration(elapsed)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
