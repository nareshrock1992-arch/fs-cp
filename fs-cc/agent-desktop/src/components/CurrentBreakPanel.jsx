import { useState, useEffect } from 'react';
import { Coffee, AlertTriangle, Check, Loader2 } from 'lucide-react';
import { formatDuration, elapsedSeconds, formatTime } from '../utils/format.js';

// Shown only while the agent is On Break. The elapsed timer is derived from the
// server-provided break_started_at (not a client-managed counter), so a browser
// refresh does not reset it. Warning/maximum are visual only — the agent is
// never auto-transitioned (no invented state changes).
export default function CurrentBreakPanel({
  breakName, breakCode, breakStartedAt,
  maxDurationSeconds, warnThresholdSeconds,
  onReturn,
}) {
  const [elapsed, setElapsed] = useState(() => elapsedSeconds(breakStartedAt));
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    setElapsed(elapsedSeconds(breakStartedAt));
    const id = setInterval(() => setElapsed(elapsedSeconds(breakStartedAt)), 1000);
    return () => clearInterval(id);
  }, [breakStartedAt]);

  const warning = warnThresholdSeconds != null && elapsed >= warnThresholdSeconds;
  const over    = maxDurationSeconds  != null && elapsed >= maxDurationSeconds;

  async function handleReturn() {
    if (returning) return;
    setReturning(true);
    try { await onReturn(); } finally { setReturning(false); }
  }

  const tone = over
    ? 'border-lamp-alert/50 bg-lamp-alert/10'
    : warning
      ? 'border-lamp-live/50 bg-lamp-live/10'
      : 'border-lamp-break/40 bg-lamp-break/10';

  return (
    <div className={`card p-4 border ${tone}`} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-lamp-break/20 border border-lamp-break/30
                          flex items-center justify-center shrink-0">
            <Coffee size={18} className="text-lamp-break" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-ink-faint font-semibold">On Break</p>
            <p className="text-sm font-bold text-ink truncate">{breakName || breakCode || 'Break'}</p>
            <p className="text-[11px] text-ink-faint">Started {formatTime(breakStartedAt)}</p>
          </div>
        </div>

        <div className="text-right">
          <p className={`font-mono text-2xl font-bold tabular-nums
            ${over ? 'text-lamp-alert' : warning ? 'text-lamp-live' : 'text-ink'}`}>
            {formatDuration(elapsed)}
          </p>
          {maxDurationSeconds != null && (
            <p className="text-[11px] text-ink-faint">
              of {formatDuration(maxDurationSeconds)} max
            </p>
          )}
        </div>

        <button
          onClick={handleReturn}
          disabled={returning}
          className="btn border text-sm font-semibold bg-lamp-available/10 border-lamp-available/30
                     hover:bg-lamp-available/20 text-lamp-available disabled:opacity-60"
        >
          {returning ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          Return to Available
        </button>
      </div>

      {(warning || over) && (
        <div className={`mt-3 flex items-start gap-2 text-xs font-medium
          ${over ? 'text-lamp-alert' : 'text-lamp-live'}`}>
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            {over
              ? 'Your configured maximum break time has been reached.'
              : 'Your configured break time is nearly complete.'}
          </span>
        </div>
      )}
    </div>
  );
}
