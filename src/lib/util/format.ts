export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`;
}

export function formatTime(local: string): string {
  return local.slice(11, 16);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Fri 12 Dec" from "2026-12-12" (calendar date, no time-zone shift). */
export function formatDay(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function weekdayName(i: number): string {
  return DAYS[i];
}

/** Calendar-day difference between two local timestamps ("+1" for next-day arrivals). */
export function dayOffset(fromLocal: string, toLocal: string): number {
  return Math.round((Date.parse(`${toLocal.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromLocal.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
