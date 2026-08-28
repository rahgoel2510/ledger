/**
 * Indian financial year helpers. The FY runs 1 April -> 31 March and is written
 * as the short two-digit pair used in invoice serials, e.g. 2026-04-01 -> "26-27".
 */

/** Returns the financial year label (e.g. "26-27") containing the given date. */
export function financialYearOf(date: Date | string): string {
  const d = typeof date === "string" ? parseIsoDate(date) : date;
  const year = d.getFullYear();
  // Months are 0-indexed: 3 === April.
  const startYear = d.getMonth() >= 3 ? year : year - 1;
  return `${twoDigit(startYear)}-${twoDigit(startYear + 1)}`;
}

/** Inclusive [start, end] calendar dates of a financial year label. */
export function financialYearRange(fy: string): { start: string; end: string } {
  const startYear = fullYearFromLabel(fy);
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

/** Financial year labels from the current one back `count - 1` years, newest first. */
export function recentFinancialYears(count = 5, today = new Date()): string[] {
  const currentStart = fullYearFromLabel(financialYearOf(today));
  return Array.from({ length: count }, (_, i) => {
    const start = currentStart - i;
    return `${twoDigit(start)}-${twoDigit(start + 1)}`;
  });
}

/** "26-27" -> "FY 2026-27", for display. */
export function formatFinancialYear(fy: string): string {
  return `FY ${fullYearFromLabel(fy)}-${fy.split("-")[1]}`;
}

/** Full start year of a label: "26-27" -> 2026. Assumes the 2000s. */
function fullYearFromLabel(fy: string): number {
  return 2000 + Number(fy.split("-")[0]);
}

function twoDigit(year: number): string {
  return String(year % 100).padStart(2, "0");
}

/** Parse a `YYYY-MM-DD` string as a *local* date, avoiding the UTC shift `new Date(str)` applies. */
export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Local `YYYY-MM-DD` for a date, without the timezone round-trip `toISOString()` causes. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayIsoDate(): string {
  return toIsoDate(new Date());
}

export function addDays(isoDate: string, days: number): string {
  const d = parseIsoDate(isoDate);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Whole days from `isoDate` to today; positive means `isoDate` is in the past. */
export function daysSince(isoDate: string, today = new Date()): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const from = parseIsoDate(isoDate).getTime();
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((to - from) / MS_PER_DAY);
}
