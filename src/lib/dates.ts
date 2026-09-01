const TZ = 'Asia/Kolkata';
export const LOCK_HOUR_MINUTES = 720; // 12:00

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const DAY_MS = 86_400_000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Parse a YYYY-MM-DD calendar date into a UTC-anchored epoch. Calendar
 *  arithmetic only — UTC has no DST, so day addition is always exact. */
function toEpoch(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromEpoch(ms: number): string {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** The current calendar date in Asia/Kolkata. en-CA formats as YYYY-MM-DD. */
export function todayIST(now: Date): string {
  return dateFmt.format(now);
}

/** Minutes elapsed since IST midnight. 0 at midnight, 720 at noon. */
export function istMinutes(now: Date): number {
  const [h, m] = timeFmt.format(now).split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** IST hour, 0–23. */
export function istHour(now: Date): number {
  return Math.floor(istMinutes(now) / 60);
}

/** Overnight silent window. Nudges fire at the top of every IST hour; this
 *  suppresses them before 07:00, so the last of the night is 23:00 and the
 *  first of the morning is 07:00. */
export function isQuietHours(now: Date): boolean {
  return istHour(now) < 7;
}

export function addDays(date: string, n: number): string {
  return fromEpoch(toEpoch(date) + n * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toEpoch(to) - toEpoch(from)) / DAY_MS);
}

/** The start date is Day 1. */
export function dayNumber(startDate: string, date: string): number {
  return daysBetween(startDate, date) + 1;
}

/** Inclusive at both ends. Empty if the range is inverted. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = toEpoch(to);
  for (let t = toEpoch(from); t <= end; t += DAY_MS) out.push(fromEpoch(t));
  return out;
}

/** Today is always editable. Yesterday is editable until 12:00 IST. */
export function isEditable(date: string, now: Date): boolean {
  const today = todayIST(now);
  if (date === today) return true;
  if (date === addDays(today, -1)) return istMinutes(now) < LOCK_HOUR_MINUTES;
  return false;
}
