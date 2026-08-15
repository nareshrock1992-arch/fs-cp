import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PhoneIncoming, PhoneCall, Headphones, Clock,
  PhoneOff, Users,
} from 'lucide-react';
import { Calls } from '../api/client.js';
import { useSocketEvent } from '../api/socket.js';
import KpiCard from '../components/KpiCard.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { KpiSkeleton } from '../components/LoadingState.jsx';

function elapsed(fromIso, tickMs) {
  if (!fromIso) return 0;
  return Math.max(0, Math.floor((tickMs - new Date(fromIso).getTime()) / 1000));
}

function fmt(s) {
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
}

function WaitingCard({ call, tick }) {
  const waitSec = elapsed(call.queue_enter_time, tick);
  const isLong  = waitSec > 120;

  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-500/25
                    bg-amber-50/50 dark:bg-amber-500/5 p-4 flex items-start gap-4
                    animate-slide-in-up">
      {/* Icon */}
      <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-500/15
                      flex items-center justify-center shrink-0">
        <PhoneIncoming size={18} className="text-amber-600 dark:text-lamp-live" />
      </div>

      {/* Info grid */}
      <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-ink-faint mb-0.5">Queue</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-ink truncate" title={call.queue_name}>
            {call.queue_name || '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-ink-faint mb-0.5">Customer</p>
          <p className="text-sm font-mono text-gray-800 dark:text-ink">{call.ani || 'Unknown'}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-ink-faint mb-0.5">Since</p>
          <p className="text-sm font-mono text-gray-600 dark:text-ink-dim">
            {call.queue_enter_time
              ? new Date(call.queue_enter_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-ink-faint mb-0.5">Waiting</p>
          <p className={`text-sm font-mono font-bold tnum ${isLong ? 'text-lamp-alert' : 'text-amber-600 dark:text-lamp-live'}`}>
            {fmt(waitSec)}
          </p>
        </div>
      </div>

      {/* Status pill */}
      <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
                       bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-lamp-live
                       border border-amber-200 dark:border-amber-500/25">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-lamp-live animate-pulse-soft" />
        WAITING
      </span>
    </div>
  );
}

function ActiveCallCard({ call, tick }) {
  const talkSec = elapsed(call.agent_answer_time, tick);

  return (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/25
                    bg-emerald-50/30 dark:bg-emerald-500/5 p-4 flex items-start gap-4
                    animate-slide-in-up">
      {/* Icon */}
      <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/15
                      flex items-center justify-center shrink-0">
        <PhoneCall size={18} className="text-emerald-600 dark:text-lamp-available" />
      </div>

      {/* Info grid */}
      <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-ink-faint mb-0.5">Agent</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-ink truncate" title={call.agent_name}>
            {call.agent_name || call.agent_id || '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-ink-faint mb-0.5">Customer</p>
          <p className="text-sm font-mono text-gray-800 dark:text-ink">{call.ani || 'Unknown'}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-ink-faint mb-0.5">Queue</p>
          <p className="text-sm text-gray-600 dark:text-ink-dim truncate" title={call.queue_name}>
            {call.queue_name || '—'}
          </p>
        </div>
        <div className="hidden sm:block">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-ink-faint mb-0.5">Extension</p>
          <p className="text-sm font-mono text-gray-500 dark:text-ink-faint">
            {call.agent_extension ? `ext ${call.agent_extension}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-ink-faint mb-0.5">Duration</p>
          <p className="text-sm font-mono font-bold tnum text-emerald-600 dark:text-lamp-available">
            {fmt(talkSec)}
          </p>
        </div>
      </div>

      {/* Status pill */}
      <span className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
                       bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-lamp-available
                       border border-emerald-200 dark:border-emerald-500/25">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-lamp-available" />
        IN CALL
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LiveCalls() {
  const [calls,   setCalls]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [tick,    setTick]    = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const rows = await Calls.live();
      setCalls(rows);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const poll  = setInterval(load, 5000);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);

  const onLiveEvent = useCallback(() => load(), [load]);
  useSocketEvent('call:enqueued',   onLiveEvent);
  useSocketEvent('call:bridged',    onLiveEvent);
  useSocketEvent('call:abandoned',  onLiveEvent);
  useSocketEvent('call:bridge-end', onLiveEvent);
  useSocketEvent('channel:hangup',  onLiveEvent);
  useSocketEvent('esl:status',      onLiveEvent);

  const { waiting, onCall } = useMemo(() => ({
    waiting: calls.filter(c => !c.agent_id && c.disposition === 'waiting'),
    onCall:  calls.filter(c =>  c.agent_id && c.disposition === 'answered'),
  }), [calls]);

  const longestWaitSec = waiting.length === 0
    ? 0
    : Math.max(...waiting.map(c => elapsed(c.queue_enter_time, tick)));

  if (loading) {
    return (
      <div className="space-y-6">
        <KpiSkeleton count={3} />
        <div className="skeleton h-48 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-500/25
                      bg-red-50 dark:bg-red-500/5 p-5">
        <p className="text-sm font-semibold text-red-600 dark:text-lamp-alert">Failed to load live calls</p>
        <p className="text-sm text-red-500 dark:text-red-400 mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          label="Waiting"
          value={waiting.length}
          tone={waiting.length > 0 ? 'amber' : 'default'}
          icon={Clock}
          sub="Callers in queue"
        />
        <KpiCard
          label="In Progress"
          value={onCall.length}
          tone={onCall.length > 0 ? 'green' : 'default'}
          icon={Headphones}
          sub="Active conversations"
        />
        <KpiCard
          label="Longest Wait"
          value={waiting.length > 0 ? fmt(longestWaitSec) : '—'}
          tone={longestWaitSec > 120 ? 'red' : longestWaitSec > 60 ? 'amber' : 'default'}
          icon={Clock}
          sub="Queue wait time"
        />
      </div>

      {/* Waiting callers */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">
            Waiting in Queue
          </h2>
          {waiting.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full
                             text-[10px] font-bold bg-amber-100 dark:bg-amber-500/20
                             text-amber-700 dark:text-lamp-live">
              {waiting.length}
            </span>
          )}
        </div>

        {waiting.length === 0 ? (
          <div className="rounded-xl border border-gray-200 dark:border-panel-border
                          bg-white dark:bg-panel-surface p-6">
            <EmptyState
              icon={PhoneOff}
              title="No callers waiting"
              body="There are currently no callers waiting in queue."
            />
          </div>
        ) : (
          <div className="space-y-3">
            {waiting.map(c => (
              <WaitingCard key={c.call_uuid} call={c} tick={tick} />
            ))}
          </div>
        )}
      </section>

      {/* Active calls */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">
            On a Call
          </h2>
          {onCall.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full
                             text-[10px] font-bold bg-emerald-100 dark:bg-emerald-500/20
                             text-emerald-700 dark:text-lamp-available">
              {onCall.length}
            </span>
          )}
        </div>

        {onCall.length === 0 ? (
          <div className="rounded-xl border border-gray-200 dark:border-panel-border
                          bg-white dark:bg-panel-surface p-6">
            <EmptyState
              icon={Users}
              title="No active calls"
              body="No calls are currently bridged to an agent."
            />
          </div>
        ) : (
          <div className="space-y-3">
            {onCall.map(c => (
              <ActiveCallCard key={c.call_uuid} call={c} tick={tick} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
