/**
 * Build wave-over-wave series from a long survey table (the shape the Mintel adapter produces):
 * one row per wave × question × statement × response × segment, with a share and a base.
 *
 * A series is kept only if it has a value in every wave its market has; gaps are never filled.
 */
import type { Series } from './stats';

export const LONG_TABLE_COLUMNS = ['market', 'wave', 'wave_year', 'wave_month', 'question_id', 'statement', 'response', 'segment_group', 'segment', 'sample_base', 'share'] as const;

/** Rows that carry a base rather than a percentage ("Sample", "Base", "Unweighted base"). */
export const BASE_RESPONSE = /^(sample|base|unweighted base|weighted base|sample size|n)$/i;

/** A value is a share only if it is a percentage; anything else is a count or a base. */
export function isShare(v: number): boolean {
  return Number.isFinite(v) && v >= 0 && v <= 100;
}

export function isLongSurveyTable(headers: readonly string[]): boolean {
  const h = new Set(headers.map((x) => x.trim().toLowerCase()));
  return ['wave_year', 'wave_month', 'statement', 'response', 'segment', 'share'].every((c) => h.has(c));
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function seriesFromLongTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  opts: { groups?: readonly string[]; maxSeries?: number } = {},
): { series: Series[]; dropped: number; periods: string[] } {
  const col = (name: string) => headers.findIndex((h) => h.trim().toLowerCase() === name);
  const c = Object.fromEntries(LONG_TABLE_COLUMNS.map((n) => [n, col(n)])) as Record<(typeof LONG_TABLE_COLUMNS)[number], number>;
  const groups = opts.groups?.map((g) => g.toLowerCase());
  const byKey = new Map<string, { meta: { market: string; statement: string; response: string; group: string; segment: string }; pts: Map<number, { label: string; v: number; b: number | null }> }>();
  const periodsByMarket = new Map<string, Map<number, string>>();

  for (const r of rows) {
    const group = (r[c.segment_group] ?? '').trim();
    if (groups && !groups.includes(group.toLowerCase())) continue;
    const year = Number(r[c.wave_year]);
    const mi = MONTHS.indexOf((r[c.wave_month] ?? '').trim().toLowerCase());
    const share = Number(r[c.share]);
    if (!Number.isFinite(year) || mi < 0 || !isShare(share)) continue;
    if (BASE_RESPONSE.test((r[c.response] ?? '').trim())) continue;
    const t = year * 12 + mi;
    const market = c.market >= 0 ? (r[c.market] ?? '').trim() : '';
    const label = `${MONTHS[mi]![0]!.toUpperCase()}${MONTHS[mi]!.slice(1)} ${year}`;
    const pm = periodsByMarket.get(market) ?? new Map<number, string>();
    pm.set(t, label);
    periodsByMarket.set(market, pm);
    const statement = (r[c.statement] ?? '').trim();
    const response = (r[c.response] ?? '').trim();
    const segment = (r[c.segment] ?? '').trim();
    const key = [market, statement, response, group, segment].join('|');
    const entry = byKey.get(key) ?? { meta: { market, statement, response, group, segment }, pts: new Map() };
    const baseRaw = c.sample_base >= 0 ? Number(r[c.sample_base]) : NaN;
    entry.pts.set(t, { label, v: share, b: Number.isFinite(baseRaw) && baseRaw > 0 ? baseRaw : null });
    byKey.set(key, entry);
  }

  const series: Series[] = [];
  let dropped = 0;
  for (const [key, { meta, pts }] of byKey) {
    const needed = periodsByMarket.get(meta.market)!;
    if (pts.size !== needed.size) {
      dropped += 1;
      continue;
    }
    const ordered = [...pts.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
    series.push({
      key,
      label: `${meta.market ? `${meta.market} · ` : ''}${meta.statement} — ${meta.response}`,
      periods: ordered.map((p) => p.label),
      values: ordered.map((p) => p.v),
      bases: ordered.map((p) => p.b),
      group: meta.group,
      segment: meta.segment,
    });
    if (opts.maxSeries && series.length >= opts.maxSeries) break;
  }
  const allPeriods = [...new Set([...periodsByMarket.values()].flatMap((m) => [...m.entries()]).sort((a, b) => a[0] - b[0]).map(([, l]) => l))];
  return { series, dropped, periods: allPeriods };
}
