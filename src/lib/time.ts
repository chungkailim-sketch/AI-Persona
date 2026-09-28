/**
 * How the application shows dates and times: GMT+8 (Singapore / China Standard Time), whatever the
 * time zone of the server or the browser. Timestamps are still stored in UTC; only display changes.
 *
 * Safe on both server and client — `Intl` with an explicit zone gives the same text in both, so a
 * server-rendered time does not change when the page hydrates.
 */
export const APP_TIME_ZONE = 'Asia/Singapore';
export const TZ_LABEL = 'GMT+8';

type DateLike = Date | string | number;

function parts(d: DateLike, seconds: boolean): Record<string, string> {
  const date = d instanceof Date ? d : new Date(d);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

/** 2026-09-28 */
export function fmtDate(d: DateLike): string {
  const p = parts(d, false);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 2026-09-28 14:05, or 2026-09-28 14:05:09 with seconds. */
export function fmtDateTime(d: DateLike, opts: { seconds?: boolean } = {}): string {
  const p = parts(d, Boolean(opts.seconds));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}${opts.seconds ? `:${p.second}` : ''}`;
}

/** 14:05:09 */
export function fmtTime(d: DateLike): string {
  const p = parts(d, true);
  return `${p.hour}:${p.minute}:${p.second}`;
}
