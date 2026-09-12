// ─────────────────────────────────────────────────────────────────────────────
// Central business-timezone / date-boundary helper.
//
// This is the SINGLE source of truth for converting a business-local calendar
// date into absolute UTC instants for querying TIMESTAMPTZ columns. Every report,
// dashboard and history "today"/date-range must go through here so there is ONE
// definition of a business day.
//
// Design guarantees:
//   • Storage stays UTC (timestamptz). We only compute UTC boundaries here.
//   • No fixed offsets, no country literals — the zone is the configured
//     BUSINESS_TIMEZONE (a valid IANA name), passed in or read from config.
//   • DST-safe: each local midnight (day start and next-day start) is resolved
//     independently, so a business day is NOT assumed to be exactly 24h.
//   • Deterministic regardless of the Node process tz, container tz, or the
//     PostgreSQL session tz — correctness depends only on BUSINESS_TIMEZONE.
//
// Boundaries are HALF-OPEN: [fromUTC, toUTC)  →  col >= fromUTC AND col < toUTC.
// ─────────────────────────────────────────────────────────────────────────────

import { config, isValidTimeZone } from '../config/index.js';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// The wall-clock that timezone `tz` shows for a given absolute UTC instant,
// expressed as a "naive-UTC" epoch (i.e. the local Y-M-D H:M:S packed via Date.UTC).
// The difference (wall - utc) is exactly the zone's UTC offset at that instant.
function wallClockMs(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const { type, value } of dtf.formatToParts(new Date(utcMs))) p[type] = value;
  // 'h23' can render midnight as hour "24" in some engines — normalize to 0.
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
                  hour, Number(p.minute), Number(p.second));
}

/**
 * The absolute UTC instant of local midnight (00:00:00.000) on the given
 * calendar date in `tz`. Solves wall(t) = target by fixed-point on the offset:
 *   t = target − offset(t),  offset(t) = wall(t) − t
 * Two passes converge for all real midnights (the 2nd pass corrects DST edges).
 * @returns {Date}
 */
export function zonedMidnightUTC(year, month, day, tz) {
  // Solve wall(t) = target by fixed-point:  t = target − offset(t),
  // where offset(t) = wallClockMs(t) − t. Iterate t_{n+1} = target − (wall(t_n) − t_n).
  const target = Date.UTC(year, month - 1, day, 0, 0, 0, 0); // desired wall clock as naive-UTC
  let utc = target;                                          // t0
  utc = target - (wallClockMs(utc, tz) - utc);              // pass 1
  utc = target - (wallClockMs(utc, tz) - utc);              // pass 2 (DST-edge correction)
  return new Date(utc);
}

// Pure calendar-date shift (no timezone involved): 'YYYY-MM-DD' ± n days.
export function shiftDate(dateStr, days) {
  const m = DATE_RE.exec(String(dateStr));
  if (!m) throw new Error(`shiftDate expects YYYY-MM-DD, got: ${dateStr}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * Half-open UTC range for one business-local calendar day.
 * @param {string} dateStr  'YYYY-MM-DD' (business calendar date)
 * @param {string} [tz]     IANA zone (defaults to configured BUSINESS_TIMEZONE)
 * @returns {{ fromUTC: Date, toUTC: Date }}  [start-of-day, start-of-next-day)
 */
export function businessDayRange(dateStr, tz = config.businessTimezone) {
  if (!isValidTimeZone(tz)) throw new Error(`businessDayRange: invalid timezone: ${tz}`);
  const m = DATE_RE.exec(String(dateStr));
  if (!m) throw new Error(`businessDayRange expects YYYY-MM-DD, got: ${dateStr}`);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const fromUTC = zonedMidnightUTC(y, mo, d, tz);
  const next = shiftDate(dateStr, 1).split('-').map(Number);
  const toUTC = zonedMidnightUTC(next[0], next[1], next[2], tz);
  return { fromUTC, toUTC };
}

/**
 * Half-open UTC range spanning [fromDate 00:00, toDate+1 00:00) in business tz.
 * Used by multi-day reports. Both bounds resolved independently (DST-safe).
 */
export function businessRange(fromDateStr, toDateStr, tz = config.businessTimezone) {
  const from = businessDayRange(fromDateStr, tz).fromUTC;
  const to   = businessDayRange(toDateStr, tz).toUTC;
  return { fromUTC: from, toUTC: to };
}

/** Current business calendar date as 'YYYY-MM-DD' in `tz`. */
export function businessToday(tz = config.businessTimezone) {
  if (!isValidTimeZone(tz)) throw new Error(`businessToday: invalid timezone: ${tz}`);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = {};
  for (const { type, value } of dtf.formatToParts(new Date())) p[type] = value;
  return `${p.year}-${p.month}-${p.day}`;
}

/** Half-open UTC range for "today" in the business timezone. */
export function businessTodayRange(tz = config.businessTimezone) {
  return businessDayRange(businessToday(tz), tz);
}

// Normalize a user-supplied date param to a business calendar date 'YYYY-MM-DD'.
// Accepts bare dates and full ISO strings (takes the date portion); returns null
// if unparseable so callers can ignore invalid filters.
export function toBusinessDateStr(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  if (DATE_RE.test(s)) return s;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}
