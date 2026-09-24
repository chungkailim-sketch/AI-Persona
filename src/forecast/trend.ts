/**
 * Trend classification — the gate's designed alternative when forecasting is refused.
 *
 * For each series, the latest wave is compared with the first and with the previous wave by a
 * two-proportion test on the published bases. Across all series tested together, significance is
 * decided with a Benjamini–Hochberg false-discovery-rate correction, and a change must also clear a
 * practical threshold (default 3 percentage points) to be called a change at all.
 */
import { benjaminiHochberg, twoProportionTest, type Series } from './stats';

export type TrendClass = 'rising' | 'falling' | 'no_detectable_change' | 'untestable';

export interface TrendRow {
  key: string;
  label: string;
  group: string;
  segment: string;
  periods: string[];
  values: number[];
  first: number;
  last: number;
  overallDiffPp: number | null;
  overallP: number | null;
  recentDiffPp: number | null;
  recentP: number | null;
  classification: TrendClass;
  recentClassification: TrendClass;
  /**
   * Most of the first-to-latest change happened in a single step. A trend is gradual; a one-step
   * jump is more often a questionnaire, translation, scale or panel change, and should be checked
   * against the supplier's methodology notes before it is read as consumer change.
   */
  stepBreak: boolean;
  reason: string;
}

/** A change of at least 8 pp where one wave-to-wave step carries ≥ 75% of it. */
export function isStepBreak(values: readonly number[]): boolean {
  if (values.length < 3) return false;
  const total = values[values.length - 1]! - values[0]!;
  if (Math.abs(total) < 8) return false;
  let biggest = 0;
  for (let i = 1; i < values.length; i += 1) {
    const d = values[i]! - values[i - 1]!;
    if (Math.sign(d) === Math.sign(total) && Math.abs(d) > Math.abs(biggest)) biggest = d;
  }
  return Math.abs(biggest) >= 0.75 * Math.abs(total);
}

export interface TrendOptions {
  fdr: number;
  minPracticalPp: number;
  designEffect: number;
}

export const DEFAULT_TREND: TrendOptions = { fdr: 0.05, minPracticalPp: 3, designEffect: 1.5 };

export function classifyTrends(series: readonly Series[], opts: TrendOptions = DEFAULT_TREND): TrendRow[] {
  const overall = series.map((s) => {
    const n = s.values.length;
    const b0 = s.bases[0];
    const bn = s.bases[n - 1];
    return n >= 2 && b0 && bn ? twoProportionTest(s.values[0]!, b0, s.values[n - 1]!, bn, opts.designEffect) : null;
  });
  const recent = series.map((s) => {
    const n = s.values.length;
    const a = s.bases[n - 2];
    const b = s.bases[n - 1];
    return n >= 2 && a && b ? twoProportionTest(s.values[n - 2]!, a, s.values[n - 1]!, b, opts.designEffect) : null;
  });
  const sigOverall = benjaminiHochberg(overall.map((t) => t?.p ?? 1), opts.fdr);
  const sigRecent = benjaminiHochberg(recent.map((t) => t?.p ?? 1), opts.fdr);

  const label = (t: ReturnType<typeof twoProportionTest>, sig: boolean): TrendClass => {
    if (!t) return 'untestable';
    if (!sig || Math.abs(t.diffPp) < opts.minPracticalPp) return 'no_detectable_change';
    return t.diffPp > 0 ? 'rising' : 'falling';
  };

  return series.map((s, i) => {
    const o = overall[i] ?? null;
    const r = recent[i] ?? null;
    const cls = label(o, sigOverall[i]!);
    const reason = !o
      ? 'No base published for the first or latest wave, so the change cannot be tested.'
      : cls === 'no_detectable_change'
        ? Math.abs(o.diffPp) < opts.minPracticalPp
          ? `Moved ${o.diffPp > 0 ? '+' : ''}${o.diffPp} pp — below the ${opts.minPracticalPp} pp practical threshold.`
          : `Moved ${o.diffPp > 0 ? '+' : ''}${o.diffPp} pp, but not significant after correcting for ${series.length} tests.`
        : `${o.diffPp > 0 ? '+' : ''}${o.diffPp} pp since ${s.periods[0]}, significant after false-discovery-rate correction.`;
    const stepBreak = isStepBreak(s.values);
    return {
      key: s.key,
      label: s.label,
      group: s.group,
      segment: s.segment,
      periods: s.periods,
      values: s.values,
      first: s.values[0]!,
      last: s.values[s.values.length - 1]!,
      overallDiffPp: o?.diffPp ?? null,
      overallP: o?.p ?? null,
      recentDiffPp: r?.diffPp ?? null,
      recentP: r?.p ?? null,
      classification: cls,
      recentClassification: label(r, sigRecent[i]!),
      stepBreak,
      reason: stepBreak ? `${reason} Most of this change happened in one step — check for a questionnaire or panel change before reading it as a trend.` : reason,
    };
  });
}
