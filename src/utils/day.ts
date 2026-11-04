/**
 * The sea keeps Brisbane time (UTC+10 all year; Queensland has no daylight saving), wherever
 * the phone is. This is a Date shifted so its UTC fields read as the Brisbane wall clock.
 */
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;

export function brisbaneClock(date: Date = new Date()): Date {
  return new Date(date.getTime() + BRISBANE_OFFSET_MS);
}

/** Hours since Brisbane midnight, with minutes as a fraction (0 to 24). */
export function brisbaneHours(date: Date = new Date()): number {
  const b = brisbaneClock(date);
  return b.getUTCHours() + b.getUTCMinutes() / 60;
}

/** Brisbane calendar day as YYYY-MM-DD, so the daily bottle turns over at Brisbane midnight. */
export function localDay(date: Date = new Date()): string {
  const b = brisbaneClock(date);
  const m = String(b.getUTCMonth() + 1).padStart(2, '0');
  const d = String(b.getUTCDate()).padStart(2, '0');
  return `${b.getUTCFullYear()}-${m}-${d}`;
}
