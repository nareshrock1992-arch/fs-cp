import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sun, Moon, ChevronDown, ShieldCheck, LogOut, Wifi, WifiOff } from 'lucide-react';
import { useSocketEvent } from '../../api/socket.js';
import { useAuth, clearToken } from '../../hooks/useAuth.js';

const TITLES = {
  '/':            ['Dashboard',       'Live system overview'],
  '/live-calls':  ['Live Calls',      'Calls in queue and in progress'],
  '/agents':      ['Agents',          'Roster, status and Avaya extension mapping'],
  '/queues':      ['Queues',          'ACD queues, strategy and tiers'],
  '/queue-stats': ['Queue Stats',     'Live per-queue statistics'],
  '/reports':     ['Reports',         'Historical queue and agent performance'],
  '/users':       ['User Management', 'Admin and supervisor accounts'],
};

// ── Admin avatar dropdown ─────────────────────────────────────────────────────

function AdminMenu({ user }) {
  const navigate   = useNavigate();
  const [open, setOpen] = useState(false);
  const ref        = useRef(null);
  const isAdmin    = user?.role === 'admin';

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function logout() {
    clearToken();
    navigate('/login', { replace: true });
  }

  const initials = (user?.username || '?').slice(0, 2).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors
          hover:bg-panel-raised border border-transparent
          ${open ? 'border-panel-border bg-panel-raised' : ''}`}
      >
        <div className="h-8 w-8 rounded-full bg-brand flex items-center justify-center
          text-white text-xs font-bold shadow-lamp-blue shrink-0">
          {initials}
        </div>
        <div className="hidden sm:block text-left leading-tight">
          <p className="text-xs font-semibold dark:text-ink text-gray-800 capitalize">
            {user?.username ?? 'User'}
          </p>
          <p className="text-[10px] uppercase tracking-wider font-medium dark:text-ink-faint text-gray-400">
            {user?.role ?? ''}
          </p>
        </div>
        <ChevronDown size={13} className={`dark:text-ink-faint text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl
          border dark:border-panel-border border-gray-200
          dark:bg-panel-surface bg-white shadow-card-hover z-[200] overflow-hidden">

          <div className="px-4 py-3 border-b dark:border-panel-border border-gray-100">
            <p className="text-xs font-bold dark:text-ink text-gray-800 capitalize">{user?.username}</p>
            <p className="text-[11px] dark:text-ink-faint text-gray-400 mt-0.5 capitalize">
              {user?.role} Account
            </p>
          </div>

          <div className="py-1">
            {isAdmin && (
              <button
                onClick={() => { setOpen(false); navigate('/users'); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm
                  dark:text-ink-dim text-gray-700
                  hover:bg-brand/10 dark:hover:bg-brand/10 hover:text-brand-light
                  transition-colors text-left"
              >
                <ShieldCheck size={15} className="shrink-0" />
                User Management
              </button>
            )}

            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm
                text-red-500 dark:text-red-400
                hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors text-left"
            >
              <LogOut size={15} className="shrink-0" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Topbar ───────────────────────────────────────────────────────────────

export default function Topbar({ isDark, toggleTheme }) {
  const { pathname }   = useLocation();
  const { user }       = useAuth();
  const [title, subtitle] = TITLES[pathname] || ['Switchboard', ''];
  const [eslConnected, setEslConnected] = useState(false);
  const [now, setNow]  = useState(new Date());

  const onEslStatus = useCallback((p) => setEslConnected(Boolean(p?.connected)), []);
  useSocketEvent('esl:status', onEslStatus);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="relative z-30 h-16 shrink-0 border-b dark:border-panel-border border-gray-200
      dark:bg-panel-surface/95 bg-white/90 backdrop-blur px-6 flex items-center justify-between">

      <div>
        <h1 className="font-display font-bold text-lg leading-tight dark:text-ink text-gray-900">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[11px] dark:text-ink-faint text-gray-400 tracking-wide">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* ESL status pill */}
        <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold
          border tracking-wide uppercase transition-colors
          ${eslConnected
            ? 'dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 border-red-200 bg-red-50 text-red-600 animate-pulse'
          }`}>
          {eslConnected
            ? <Wifi size={11} />
            : <WifiOff size={11} />}
          <span className="hidden sm:inline">
            {eslConnected ? 'Contact Center Connected' : 'Contact Center Offline'}
          </span>
        </div>

        {/* Clock */}
        <span className="text-sm font-mono dark:text-ink-faint text-gray-400 hidden md:inline px-2">
          {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="h-8 w-8 flex items-center justify-center rounded-lg
            border dark:border-panel-border border-gray-200
            dark:bg-panel-raised bg-gray-50
            dark:text-ink-faint text-gray-500
            hover:dark:text-ink hover:text-gray-900
            dark:hover:bg-panel-border hover:bg-gray-100 transition-colors"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        <AdminMenu user={user} />
      </div>
    </header>
  );
}
