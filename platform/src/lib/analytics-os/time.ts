import type { AnalyticsDateRangeStrategy } from "./validation";

/**
 * ============================================================================
 * Business-timezone-aware date range resolution — Module 17
 * ============================================================================
 * No timezone library exists in this codebase yet (`date-fns-tz`, `luxon`,
 * etc. are not installed) — this file uses only the native `Intl` API,
 * matching the same "no new dependency for one localized concern" judgment
 * already made for Marketing/Sales OS's own `businessTimezone` field
 * (stored, validated, but not yet load-bearing for date math anywhere
 * else in the codebase). Every boundary below is computed in the org's
 * declared IANA `businessTimezone`, then converted to a real UTC instant —
 * never a naive UTC-midnight assumption.
 */

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // "24" is returned for midnight by some engines under hour12:false — normalize to 0.
  const hour = get("hour") % 24;
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute"), second: get("second") };
}

/** The real UTC instant corresponding to a given wall-clock date/time in `timeZone`. */
function zonedWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const asZoned = getZonedParts(utcGuess, timeZone);
  const asZonedUtcMillis = Date.UTC(asZoned.year, asZoned.month - 1, asZoned.day, asZoned.hour, asZoned.minute, asZoned.second);
  const diffMillis = utcGuess.getTime() - asZonedUtcMillis;
  return new Date(utcGuess.getTime() + diffMillis);
}

function zonedStartOfDay(year: number, month: number, day: number, timeZone: string): Date {
  return zonedWallClockToUtc(year, month, day, 0, 0, 0, timeZone);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Shifts a wall-clock Y/M/D back by `months`, clamping the day to the target month's real length (e.g. Mar 31 - 1 month -> Feb 28/29, never Mar 3). */
function shiftMonthsBack(year: number, month: number, day: number, months: number): { year: number; month: number; day: number } {
  const totalMonths = (year * 12 + (month - 1)) - months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const clampedDay = Math.min(day, daysInMonth(newYear, newMonth));
  return { year: newYear, month: newMonth, day: clampedDay };
}

export interface ResolvedDateRange {
  from: Date;
  to: Date;
}

/**
 * Resolves a named strategy to a concrete [from, to] range in the org's own
 * business timezone. "custom" requires the caller's own already-validated
 * from/to (see `dateRangeSchema`) and is passed straight through.
 */
export function resolveDateRangeForStrategy(strategy: AnalyticsDateRangeStrategy, businessTimezone: string, custom: { from: Date; to: Date } | null, now: Date = new Date()): ResolvedDateRange {
  if (strategy === "custom") {
    if (!custom) throw new Error("custom date range strategy requires an explicit from/to");
    return { from: custom.from, to: custom.to };
  }

  const today = getZonedParts(now, businessTimezone);

  switch (strategy) {
    case "last_7_days": {
      const startOfToday = zonedStartOfDay(today.year, today.month, today.day, businessTimezone);
      return { from: new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000), to: now };
    }
    case "last_30_days": {
      const startOfToday = zonedStartOfDay(today.year, today.month, today.day, businessTimezone);
      return { from: new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000), to: now };
    }
    case "last_90_days": {
      const startOfToday = zonedStartOfDay(today.year, today.month, today.day, businessTimezone);
      return { from: new Date(startOfToday.getTime() - 89 * 24 * 60 * 60 * 1000), to: now };
    }
    case "month_to_date": {
      return { from: zonedStartOfDay(today.year, today.month, 1, businessTimezone), to: now };
    }
    case "quarter_to_date": {
      const quarterStartMonth = Math.floor((today.month - 1) / 3) * 3 + 1;
      return { from: zonedStartOfDay(today.year, quarterStartMonth, 1, businessTimezone), to: now };
    }
    case "year_to_date": {
      return { from: zonedStartOfDay(today.year, 1, 1, businessTimezone), to: now };
    }
    default: {
      const _exhaustive: never = strategy;
      throw new Error(`Unhandled date range strategy: ${_exhaustive}`);
    }
  }
}

export const COMPARISON_STRATEGIES = ["previous_period", "previous_month", "previous_quarter", "previous_year", "custom", "none"] as const;
export type ComparisonStrategy = (typeof COMPARISON_STRATEGIES)[number];

/**
 * Resolves the comparison period for a given current [from, to] range.
 * "previous_period" shifts back by the exact duration of the current range
 * (works for any strategy, including custom). "previous_month/quarter/year"
 * do real calendar-month arithmetic on the wall-clock boundary in the
 * business timezone (clamped day), not a fixed day count — so a
 * month-to-date range compares against the analogous days of the prior
 * month, not an arbitrary 30-day shift.
 */
export function resolveComparisonRange(
  strategy: ComparisonStrategy,
  current: ResolvedDateRange,
  businessTimezone: string,
  custom: { from: Date; to: Date } | null
): ResolvedDateRange | null {
  if (strategy === "none") return null;
  if (strategy === "custom") {
    if (!custom) throw new Error("custom comparison strategy requires an explicit from/to");
    return { from: custom.from, to: custom.to };
  }
  if (strategy === "previous_period") {
    const durationMillis = current.to.getTime() - current.from.getTime();
    return { from: new Date(current.from.getTime() - durationMillis), to: new Date(current.from.getTime()) };
  }

  const monthsBack = strategy === "previous_month" ? 1 : strategy === "previous_quarter" ? 3 : 12;
  const fromParts = getZonedParts(current.from, businessTimezone);
  const toParts = getZonedParts(current.to, businessTimezone);
  const shiftedFrom = shiftMonthsBack(fromParts.year, fromParts.month, fromParts.day, monthsBack);
  const shiftedTo = shiftMonthsBack(toParts.year, toParts.month, toParts.day, monthsBack);
  return {
    from: zonedWallClockToUtc(shiftedFrom.year, shiftedFrom.month, shiftedFrom.day, fromParts.hour, fromParts.minute, fromParts.second, businessTimezone),
    to: zonedWallClockToUtc(shiftedTo.year, shiftedTo.month, shiftedTo.day, toParts.hour, toParts.minute, toParts.second, businessTimezone),
  };
}

/** Percentage change from previous to current, explicitly representing the zero-denominator case as `null` rather than a misleading 0% or Infinity. */
export function computePercentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
