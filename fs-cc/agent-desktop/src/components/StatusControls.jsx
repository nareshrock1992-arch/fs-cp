import { useState, useRef, useEffect } from 'react';
import { Check, Coffee, LogOut, Loader2, ChevronDown } from 'lucide-react';
import { api } from '../api/client.js';

// The three base agent statuses are NOT break codes. 'On Break' is entered via
// the break-code menu below (codes are business configuration loaded from the
// backend — never hardcoded here).

export default function StatusControls({ currentStatus, breakCodes, onStatusChange, onError }) {
  const [changing, setChanging] = useState(null);   // status value currently posting
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close the break menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  async function post(status, breakCode) {
    if (changing) return;
    setChanging(status);
    setMenuOpen(false);
    try {
      const res = await api.setStatus(status, breakCode);
      onStatusChange(res.status ?? status);
    } catch (err) {
      onError?.(err.message || 'Failed to change status');
    } finally {
      setChanging(null);
    }
  }

  const onBreak = currentStatus === 'On Break';
  const available = currentStatus === 'Available';

  return (
    <div className="card p-4">
      <p className="stat-label mb-3">Your Status</p>
      <div className="flex flex-wrap gap-2">

        {/* Available */}
        <button
          onClick={() => post('Available')}
          disabled={!!changing || available}
          aria-pressed={available}
          className={`btn border text-sm font-semibold transition-all
            ${available
              ? 'bg-lamp-available/20 border-lamp-available text-lamp-available shadow-lamp-green'
              : 'bg-lamp-available/10 border-lamp-available/30 hover:bg-lamp-available/20 text-ink-dim'}
            disabled:opacity-60`}
        >
          {changing === 'Available'
            ? <Loader2 size={15} className="animate-spin" />
            : <>{available && <span className="w-2 h-2 rounded-full shrink-0 bg-lamp-available shadow-lamp-green" />}<Check size={15} /></>}
          Available
        </button>

        {/* Take Break (dropdown) */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            disabled={!!changing}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            className={`btn border text-sm font-semibold transition-all
              ${onBreak
                ? 'bg-lamp-break/20 border-lamp-break text-lamp-break shadow-lamp-blue'
                : 'bg-lamp-break/10 border-lamp-break/30 hover:bg-lamp-break/20 text-ink-dim'}
              disabled:opacity-60`}
          >
            {changing === 'On Break'
              ? <Loader2 size={15} className="animate-spin" />
              : <>{onBreak && <span className="w-2 h-2 rounded-full shrink-0 bg-lamp-break shadow-lamp-blue" />}<Coffee size={15} /></>}
            {onBreak ? 'Change Break' : 'Take Break'}
            <ChevronDown size={14} className={`transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <div
              role="listbox"
              aria-label="Select break reason"
              className="absolute z-20 mt-1 w-56 max-h-72 overflow-y-auto rounded-lg border
                         border-panel-border bg-panel-surface shadow-xl py-1"
            >
              {(!breakCodes || breakCodes.length === 0) ? (
                <p className="px-3 py-3 text-xs text-ink-faint">
                  No break reasons configured. Ask your supervisor.
                </p>
              ) : breakCodes.map(bc => (
                <button
                  key={bc.code}
                  role="option"
                  onClick={() => post('On Break', bc.code)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-ink-dim
                             hover:bg-panel-raised focus:bg-panel-raised focus:outline-none text-left"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 border border-panel-border"
                    style={bc.color ? { backgroundColor: bc.color } : undefined}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate">{bc.name}</span>
                  {bc.max_duration_seconds
                    ? <span className="text-[10px] text-ink-faint">{Math.round(bc.max_duration_seconds / 60)}m</span>
                    : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Log Out */}
        <button
          onClick={() => post('Logged Out')}
          disabled={!!changing}
          className="btn border text-sm font-semibold transition-all
                     bg-panel-raised border-panel-border hover:bg-panel-border/60 text-ink-dim
                     disabled:opacity-60"
        >
          {changing === 'Logged Out'
            ? <Loader2 size={15} className="animate-spin" />
            : <LogOut size={15} />}
          Log Out
        </button>
      </div>
    </div>
  );
}
