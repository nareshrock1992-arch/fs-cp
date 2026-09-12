// ─────────────────────────────────────────────────────────────────────────────
// Shared query helpers for paginated / date-filtered history endpoints.
// Keep pagination and date handling consistent (and safe) across agent and
// supervisor history APIs. All values are validated and pushed as bound
// parameters by the caller — these helpers never concatenate user input.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from '../config/index.js';
import { businessDayRange, toBusinessDateStr } from './timezone.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 200;

/**
 * Parse page/limit into a safe { page, limit, offset }.
 * page >= 1, 1 <= limit <= MAX_LIMIT (default 50).
 */
export function parsePagination(q = {}) {
  let page  = Number.parseInt(q.page, 10);
  let limit = Number.parseInt(q.limit, 10);
  if (!Number.isInteger(page)  || page  < 1) page  = 1;
  if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  return { page, limit, offset: (page - 1) * limit };
}

/** True if value is a parseable date. */
function isValidDate(v) {
  if (v == null || v === '') return false;
  const t = Date.parse(v);
  return !Number.isNaN(t);
}

/**
 * Build date-range SQL conditions for `column`, pushing bound params onto
 * `params`. start_date / end_date are business CALENDAR dates (YYYY-MM-DD, or an
 * ISO string whose date portion is used), interpreted in BUSINESS_TIMEZONE — NOT
 * UTC and NOT the container/session tz. The range is HALF-OPEN:
 *   column >= start-of(start_date)   AND   column < start-of(end_date + 1 day)
 * so the entire end_date business day is included (fixing the old inclusive-`<=`
 * end that truncated the day to its first instant). Invalid dates are ignored.
 */
export function applyDateRange(q = {}, params, column, tz = config.businessTimezone) {
  const conds = [];
  const startStr = toBusinessDateStr(q.start_date);
  if (startStr) {
    params.push(businessDayRange(startStr, tz).fromUTC.toISOString());
    conds.push(`${column} >= $${params.length}`);
  }
  const endStr = toBusinessDateStr(q.end_date);
  if (endStr) {
    params.push(businessDayRange(endStr, tz).toUTC.toISOString());
    conds.push(`${column} < $${params.length}`);
  }
  return conds;
}
