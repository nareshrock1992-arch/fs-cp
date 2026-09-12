// Shared formatting helpers for the Agent Desktop.

/** Seconds → "H:MM:SS" or "MM:SS". Null/negative render as "—". */
export function formatDuration(totalSeconds) {
  if (totalSeconds == null || Number.isNaN(totalSeconds) || totalSeconds < 0) return '—';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Elapsed whole seconds from an ISO timestamp until now (0 if missing/future). */
export function elapsedSeconds(sinceIso) {
  if (!sinceIso) return 0;
  const t = Date.parse(sinceIso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

/** Locale time, e.g. "14:32". */
export function formatTime(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Locale date-time, e.g. "05 Sep 2026, 14:32". */
export function formatDateTime(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleString([], {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
