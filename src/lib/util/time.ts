// Time-zone helpers built on Intl (no dependency). Local times are "YYYY-MM-DDTHH:mm" wall-clock strings.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

function partsOf(utcMs: number, tz: string) {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `tz` from UTC in minutes at the given instant. */
export function tzOffsetMinutes(utcMs: number, tz: string): number {
  const p = partsOf(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - utcMs) / 60000);
}

function parseLocal(local: string): number {
  const [d, t = '00:00'] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return Date.UTC(y, m - 1, day, hh, mm);
}

/** Converts a local wall-clock time in `tz` to UTC epoch ms. */
export function localToUtc(local: string, tz: string): number {
  const naive = parseLocal(local);
  const first = tzOffsetMinutes(naive, tz);
  let utc = naive - first * 60000;
  const second = tzOffsetMinutes(utc, tz);
  if (second !== first) utc = naive - second * 60000;
  return utc;
}

/** Formats a UTC instant as local wall-clock "YYYY-MM-DDTHH:mm" in `tz`. */
export function utcToLocal(utcMs: number, tz: string): string {
  const p = partsOf(utcMs, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Treats a local time string as if it were UTC (useful for same-airport differences). */
export function localAsUtcMs(local: string): number {
  return parseLocal(local);
}

export function minutesOfDay(local: string): number {
  const t = local.slice(11, 16);
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function localDate(local: string): string {
  return local.slice(0, 10);
}

/** Parses ISO-8601 durations such as "PT2H35M" or "P1DT2H" into minutes. */
export function parseIsoDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!m) return null;
  const [, d, h, min] = m;
  return Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(min ?? 0);
}
