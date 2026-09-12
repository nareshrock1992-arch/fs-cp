import { describe, it, expect } from 'vitest';
import {
  zonedMidnightUTC, businessDayRange, businessRange,
  businessToday, businessTodayRange, shiftDate, toBusinessDateStr,
} from '../../../utils/timezone.js';

// These tests PROVE the dependency-free Intl/fixed-point conversion is correct for
// positive, negative and 30-minute offsets, and across DST transitions, with the
// process/container tz irrelevant (all expectations are absolute UTC instants).

const iso = (d) => d.toISOString();

describe('businessDayRange — fixed offsets (no DST)', () => {
  it('Asia/Riyadh (+03:00): 2026-09-11 → [09-10T21:00Z, 09-11T21:00Z)', () => {
    const r = businessDayRange('2026-09-11', 'Asia/Riyadh');
    expect(iso(r.fromUTC)).toBe('2026-09-10T21:00:00.000Z');
    expect(iso(r.toUTC)).toBe('2026-09-11T21:00:00.000Z');
  });

  it('Asia/Kolkata (+05:30): 2026-09-12 → [09-11T18:30Z, 09-12T18:30Z)', () => {
    const r = businessDayRange('2026-09-12', 'Asia/Kolkata');
    expect(iso(r.fromUTC)).toBe('2026-09-11T18:30:00.000Z');
    expect(iso(r.toUTC)).toBe('2026-09-12T18:30:00.000Z');
  });

  it('UTC: 2026-09-11 → [09-11T00:00Z, 09-12T00:00Z)', () => {
    const r = businessDayRange('2026-09-11', 'UTC');
    expect(iso(r.fromUTC)).toBe('2026-09-11T00:00:00.000Z');
    expect(iso(r.toUTC)).toBe('2026-09-12T00:00:00.000Z');
  });

  it('America/New_York (EDT −04): 2026-09-11 → [09-11T04:00Z, 09-12T04:00Z)', () => {
    const r = businessDayRange('2026-09-11', 'America/New_York');
    expect(iso(r.fromUTC)).toBe('2026-09-11T04:00:00.000Z');
    expect(iso(r.toUTC)).toBe('2026-09-12T04:00:00.000Z');
  });
});

describe('same absolute instant → different business day membership (invariant instant)', () => {
  const instant = Date.parse('2026-09-11T21:30:00.000Z'); // fixed UTC instant
  const inRange = (dateStr, tz) => {
    const { fromUTC, toUTC } = businessDayRange(dateStr, tz);
    return instant >= fromUTC.getTime() && instant < toUTC.getTime();
  };
  it('belongs to 2026-09-12 in Riyadh', () => expect(inRange('2026-09-12', 'Asia/Riyadh')).toBe(true));
  it('belongs to 2026-09-12 in Kolkata', () => expect(inRange('2026-09-12', 'Asia/Kolkata')).toBe(true));
  it('belongs to 2026-09-11 in UTC', () => expect(inRange('2026-09-11', 'UTC')).toBe(true));
  it('belongs to 2026-09-11 in New York', () => expect(inRange('2026-09-11', 'America/New_York')).toBe(true));
  it('does NOT belong to 2026-09-11 in Riyadh', () => expect(inRange('2026-09-11', 'Asia/Riyadh')).toBe(false));
});

describe('DST correctness (America/New_York) — days are not always 24h', () => {
  it('spring-forward 2026-03-08 spans 23h', () => {
    const r = businessDayRange('2026-03-08', 'America/New_York');
    expect(iso(r.fromUTC)).toBe('2026-03-08T05:00:00.000Z'); // EST −05
    expect(iso(r.toUTC)).toBe('2026-03-09T04:00:00.000Z');   // EDT −04
    expect(r.toUTC.getTime() - r.fromUTC.getTime()).toBe(23 * 3600 * 1000);
  });
  it('fall-back 2026-11-01 spans 25h', () => {
    const r = businessDayRange('2026-11-01', 'America/New_York');
    expect(iso(r.fromUTC)).toBe('2026-11-01T04:00:00.000Z'); // EDT −04
    expect(iso(r.toUTC)).toBe('2026-11-02T05:00:00.000Z');   // EST −05
    expect(r.toUTC.getTime() - r.fromUTC.getTime()).toBe(25 * 3600 * 1000);
  });
});

describe('half-open boundary semantics (UTC)', () => {
  const { fromUTC, toUTC } = businessDayRange('2026-09-11', 'UTC');
  const inRange = (ms) => ms >= fromUTC.getTime() && ms < toUTC.getTime();
  it('00:00:00.000 included', () => expect(inRange(Date.parse('2026-09-11T00:00:00.000Z'))).toBe(true));
  it('00:00:00.001 included', () => expect(inRange(Date.parse('2026-09-11T00:00:00.001Z'))).toBe(true));
  it('23:59:59.999 included', () => expect(inRange(Date.parse('2026-09-11T23:59:59.999Z'))).toBe(true));
  it('previous 23:59:59.999 excluded', () => expect(inRange(Date.parse('2026-09-10T23:59:59.999Z'))).toBe(false));
  it('next day 00:00:00.000 excluded', () => expect(inRange(Date.parse('2026-09-12T00:00:00.000Z'))).toBe(false));
});

describe('businessToday / businessTodayRange', () => {
  it('businessToday returns YYYY-MM-DD', () => {
    expect(businessToday('Asia/Riyadh')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('today range contains now for any zone', () => {
    for (const tz of ['Asia/Riyadh', 'Asia/Kolkata', 'UTC', 'America/New_York']) {
      const { fromUTC, toUTC } = businessTodayRange(tz);
      const now = Date.now();
      expect(now >= fromUTC.getTime() && now < toUTC.getTime()).toBe(true);
    }
  });
});

describe('helpers: shiftDate, businessRange, toBusinessDateStr, validation', () => {
  it('shiftDate crosses month boundary', () => {
    expect(shiftDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('businessRange spans multiple days half-open', () => {
    const r = businessRange('2026-09-11', '2026-09-12', 'UTC');
    expect(iso(r.fromUTC)).toBe('2026-09-11T00:00:00.000Z');
    expect(iso(r.toUTC)).toBe('2026-09-13T00:00:00.000Z'); // through end of 09-12
  });
  it('toBusinessDateStr normalizes bare and ISO input', () => {
    expect(toBusinessDateStr('2026-09-11')).toBe('2026-09-11');
    expect(toBusinessDateStr('2026-09-11T13:00:00Z')).toBe('2026-09-11');
    expect(toBusinessDateStr('')).toBe(null);
    expect(toBusinessDateStr('not-a-date')).toBe(null);
  });
  it('invalid timezone throws', () => {
    expect(() => businessDayRange('2026-09-11', 'Not/AZone')).toThrow();
  });
  it('invalid date throws', () => {
    expect(() => businessDayRange('09/11/2026', 'UTC')).toThrow();
  });
});
