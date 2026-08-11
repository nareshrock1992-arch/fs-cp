import { useState, useEffect, useCallback } from 'react';
import { api }            from '../api/client.js';
import { socket }         from '../api/socket.js';
import StatusControls     from '../components/StatusControls.jsx';
import QueueCard          from '../components/QueueCard.jsx';
import LiveCallPanel      from '../components/LiveCallPanel.jsx';
import EslBadge           from '../components/EslBadge.jsx';
import PerformanceCard    from '../components/PerformanceCard.jsx';
import ThemeToggle        from '../components/ThemeToggle.jsx';

const QUEUE_INTERVAL = 3_000;
const PERF_INTERVAL  = 30_000;

function statusDotClass(status) {
  switch (status) {
    case 'Available': return 'bg-lamp-available shadow-lamp-green';
    case 'On Break':  return 'bg-lamp-break shadow-lamp-blue';
    default:          return 'bg-ink-faint';
  }
}
function statusTextClass(status) {
  switch (status) {
    case 'Available': return 'text-lamp-available';
    case 'On Break':  return 'text-lamp-break';
    default:          return 'text-ink-faint';
  }
}

export default function Dashboard({ auth, theme }) {
  const { agent, logout, updateAgent } = auth;

  const [queues,      setQueues]      = useState([]);
  const [perf,        setPerf]        = useState(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [eslConn,     setEslConn]     = useState(false);
  const [callState,   setCallState]   = useState(null);

  const agentId     = agent?.agent_id;
  const agentStatus = agent?.status || 'Logged Out';

  // ── Queue stats polling ───────────────────────────────────────────────────
  const fetchQueues = useCallback(async () => {
    try { setQueues(await api.queues()); } catch {}
  }, []);

  useEffect(() => {
    fetchQueues();
    const id = setInterval(fetchQueues, QUEUE_INTERVAL);
    return () => clearInterval(id);
  }, [fetchQueues]);

  // ── Performance polling ───────────────────────────────────────────────────
  const fetchPerf = useCallback(async () => {
    try { setPerf(await api.performance()); }
    catch {}
    finally { setPerfLoading(false); }
  }, []);

  useEffect(() => {
    fetchPerf();
    const id = setInterval(fetchPerf, PERF_INTERVAL);
    return () => clearInterval(id);
  }, [fetchPerf]);

  // ── Active call polling (fallback) ────────────────────────────────────────
  const fetchCalls = useCallback(async () => {
    try {
      const calls  = await api.calls();
      const active = calls.find(c => !c.end_time);
      if (active) {
        setCallState(prev => {
          if (prev?.phase === 'talking' && prev.callUuid === active.call_uuid) return prev;
          return {
            phase:     active.agent_answer_time ? 'talking' : 'ringing',
            callUuid:  active.call_uuid,
            ani:       active.ani,
            queueName: active.queue_name,
            startedAt: active.agent_answer_time || active.queue_enter_time || active.start_time,
          };
        });
      } else {
        setCallState(null);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchCalls();
    const id = setInterval(fetchCalls, QUEUE_INTERVAL);
    return () => clearInterval(id);
  }, [fetchCalls]);

  // ── Socket.IO real-time events ────────────────────────────────────────────
  useEffect(() => {
    // Re-sync ESL status on every socket connect/reconnect.
    // The backend emits esl:status immediately on connection (socketService.js),
    // but that event can be missed if the Socket.IO transport drops during the
    // FreeSWITCH restart window. This REST call guarantees the UI reflects the
    // authoritative backend state regardless of event delivery timing.
    const onConnect = async () => {
      try {
        const { connected } = await api.eslStatus();
        setEslConn(connected);
      } catch { /* ignore — esl:status socket event is the primary path */ }
    };

    const onEslStatus   = ({ connected }) => setEslConn(connected);
    const onQueueUpdate = () => fetchQueues();
    const onHangup      = () => fetchCalls();

    const onAgentOffering = ({ callUuid, agentId: evtAgent }) => {
      if (evtAgent !== agentId) return;
      setCallState(prev =>
        prev?.callUuid === callUuid ? prev
          : { phase: 'ringing', callUuid, ani: null, queueName: null, startedAt: new Date().toISOString() }
      );
      fetchCalls();
    };

    const onCallBridged = ({ callUuid, agentId: evtAgent }) => {
      if (evtAgent !== agentId) return;
      setCallState(prev =>
        prev?.callUuid === callUuid
          ? { ...prev, phase: 'talking', startedAt: prev.startedAt || new Date().toISOString() }
          : prev
      );
      fetchCalls();
    };

    const onCallEnd = ({ callUuid }) => {
      setCallState(prev => prev?.callUuid === callUuid ? null : prev);
      setTimeout(fetchPerf, 2000);
    };

    const onAgentNoAnswer = ({ callUuid, agentId: evtAgent }) => {
      if (evtAgent !== agentId) return;
      setCallState(prev => prev?.callUuid === callUuid ? null : prev);
      setTimeout(fetchPerf, 2000);
    };

    const onAgentStatus = ({ agentId: evtAgent, status }) => {
      if (evtAgent !== agentId) return;
      updateAgent({ status });
    };

    const onAgentState = ({ agentId: evtAgent, status, state }) => {
      if (evtAgent !== agentId) return;
      updateAgent({ status, state });
    };

    socket.on('connect',         onConnect);
    // If socket is already connected when this effect runs (e.g. initial mount
    // after the connection was established), fetch current status immediately —
    // the server's connect-time esl:status emit may have arrived before this
    // listener was registered.
    if (socket.connected) onConnect();
    socket.on('esl:status',      onEslStatus);
    socket.on('agent:offering',  onAgentOffering);
    socket.on('call:bridged',    onCallBridged);
    socket.on('call:bridge-end', onCallEnd);
    socket.on('channel:hangup',  onHangup);
    socket.on('agent:no-answer', onAgentNoAnswer);
    socket.on('agent:status',    onAgentStatus);
    socket.on('agent:state',     onAgentState);
    socket.on('call:enqueued',   onQueueUpdate);
    socket.on('call:abandoned',  onQueueUpdate);

    return () => {
      socket.off('connect',         onConnect);
      socket.off('esl:status',      onEslStatus);
      socket.off('agent:offering',  onAgentOffering);
      socket.off('call:bridged',    onCallBridged);
      socket.off('call:bridge-end', onCallEnd);
      socket.off('channel:hangup',  onHangup);
      socket.off('agent:no-answer', onAgentNoAnswer);
      socket.off('agent:status',    onAgentStatus);
      socket.off('agent:state',     onAgentState);
      socket.off('call:enqueued',   onQueueUpdate);
      socket.off('call:abandoned',  onQueueUpdate);
    };
  }, [agentId, fetchQueues, fetchCalls, fetchPerf, updateAgent]);

  async function handleLogout() {
    try { await api.setStatus('Logged Out'); } catch {}
    logout();
  }

  function handleStatusChange(newStatus) {
    updateAgent({ status: newStatus });
    if (newStatus === 'Logged Out') setTimeout(logout, 500);
  }

  return (
    <div className="min-h-screen bg-panel-bg flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-panel-surface border-b border-panel-border px-4 py-3
                         flex items-center gap-3 sticky top-0 z-10">
        {/* Logo */}
        <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21
                 l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502
                 l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        </div>

        <span className="text-xs font-bold text-brand-light tracking-wide uppercase hidden sm:block">
          Agent Desktop
        </span>

        <div className="flex-1" />

        <EslBadge connected={eslConn} />

        {/* Agent pill */}
        <div className="flex items-center gap-2 pl-2 border-l border-panel-border">
          <span className={`w-2 h-2 rounded-full ${statusDotClass(agentStatus)}`} />
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-ink leading-tight">{agent?.full_name}</p>
            <p className={`text-[11px] font-medium ${statusTextClass(agentStatus)}`}>{agentStatus}</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-brand/20 border border-brand/30
                          flex items-center justify-center text-brand-light font-bold text-sm">
            {(agent?.full_name?.[0] || 'A').toUpperCase()}
          </div>
        </div>

        {/* Theme toggle */}
        <ThemeToggle isDark={theme.isDark} onToggle={theme.toggle} />

        {/* Logout */}
        <button
          onClick={handleLogout}
          title="Logout"
          className="p-2 rounded-lg text-ink-faint hover:text-ink-dim
                     hover:bg-panel-raised transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0
                 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 p-4 space-y-4 max-w-5xl w-full mx-auto">

        {callState && <LiveCallPanel callState={callState} />}

        <StatusControls currentStatus={agentStatus} onStatusChange={handleStatusChange} />

        <PerformanceCard perf={perf} loading={perfLoading} />

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink-dim uppercase tracking-wider">
              My Queues
            </h2>
            <span className="text-[11px] text-ink-faint">Live · 3s refresh</span>
          </div>

          {queues.length === 0 ? (
            <div className="card p-8 text-center text-ink-faint text-sm">
              No queues assigned — ask your supervisor to add you to a queue in the Admin UI.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {queues.map(q => <QueueCard key={q.name} q={q} />)}
            </div>
          )}
        </div>

        <div className="text-[11px] text-ink-faint flex flex-wrap gap-4
                        border-t border-panel-border pt-3">
          <span>Agent: <code className="text-ink-dim">{agent?.agent_id}</code></span>
          <span>Extension: <code className="text-ink-dim">{agent?.avaya_extension}</code></span>
        </div>
      </main>

      <footer className="border-t border-panel-border px-4 py-2 text-center">
        <p className="text-[11px] text-ink-faint">
          CC Version 1.0.0 · © Naresh — All Rights Reserved
        </p>
      </footer>
    </div>
  );
}
