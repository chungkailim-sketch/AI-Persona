/**
 * Deterministic statistics for time series: baselines, error metrics, rolling-origin backtests,
 * and significance tests for change in a survey share. Computed in code, never by a model
 * (PRD §21, §24.8).
 */

export interface Series {
  key: string;
  label: string;
  /** Period labels, oldest first — e.g. "March 2024". */
  periods: string[];
  /** Shares in percent (0–100), aligned with `periods`. */
  values: number[];
  /** Respondent base per period; null where the source gives none. */
  bases: (number | null)[];
  group: string;
  segment: string;
}

export type BaselineName = 'naive' | 'seasonal_naive' | 'drift' | 'mean';

/** Point forecasts from a baseline for `horizon` steps after `context`. Seasonal period in steps. */
export function baselineForecast(name: BaselineName, context: readonly number[], horizon: number, period = 2): number[] {
  const n = context.length;
  if (n === 0) return Array(horizon).fill(NaN);
  const last = context[n - 1]!;
  switch (name) {
    case 'naive':
      return Array(horizon).fill(last);
    case 'mean': {
      const m = context.reduce((s, v) => s + v, 0) / n;
      return Array(horizon).fill(m);
    }
    case 'drift': {
      const slope = n > 1 ? (last - context[0]!) / (n - 1) : 0;
      return Array.from({ length: horizon }, (_, i) => clamp(last + slope * (i + 1)));
    }
    case 'seasonal_naive':
      if (n < period) return Array(horizon).fill(last);
      return Array.from({ length: horizon }, (_, i) => context[n - period + (i % period)]!);
  }
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export function mae(actual: readonly number[], forecast: readonly number[]): number {
  return actual.reduce((s, a, i) => s + Math.abs(a - forecast[i]!), 0) / actual.length;
}

/** Symmetric MAPE in percent. Terms where both values are 0 contribute 0. */
export function smape(actual: readonly number[], forecast: readonly number[]): number {
  let s = 0;
  actual.forEach((a, i) => {
    const f = forecast[i]!;
    const d = Math.abs(a) + Math.abs(f);
    s += d === 0 ? 0 : (2 * Math.abs(a - f)) / d;
  });
  return (100 * s) / actual.length;
}

/**
 * MASE: error scaled by the in-sample one-step naive error. Below 1 beats the naive forecast.
 * Returns null when the in-sample naive error is 0 (a constant history), where the scale is undefined.
 */
export function mase(actual: readonly number[], forecast: readonly number[], history: readonly number[]): number | null {
  if (history.length < 2) return null;
  let d = 0;
  for (let i = 1; i < history.length; i += 1) d += Math.abs(history[i]! - history[i - 1]!);
  d /= history.length - 1;
  return d === 0 ? null : mae(actual, forecast) / d;
}

/** Pinball (quantile) loss for one quantile level. */
export function pinball(actual: readonly number[], q: readonly number[], level: number): number {
  return actual.reduce((s, a, i) => {
    const e = a - q[i]!;
    return s + Math.max(level * e, (level - 1) * e);
  }, 0) / actual.length;
}

export interface BacktestResult {
  origins: number;
  horizon: number;
  /** Mean absolute error per method, percentage points. */
  mae: Record<string, number>;
  smape: Record<string, number>;
  /** Mean MASE per method where defined. */
  mase: Record<string, number | null>;
  /** Share of origins where `candidate` beat naive on MAE; null when no candidate. */
  candidateBeatsNaive: number | null;
}

export type Forecaster = (context: readonly number[], horizon: number) => number[];

/**
 * Rolling-origin backtest: for each origin from `minContext` to the end, forecast `horizon` steps
 * and score against what happened. Every method sees exactly the same contexts.
 */
export function rollingBacktest(
  values: readonly number[],
  horizon: number,
  minContext: number,
  methods: Record<string, Forecaster>,
  candidate?: string,
): BacktestResult | null {
  const errs: Record<string, number[]> = {};
  const sm: Record<string, number[]> = {};
  const ms: Record<string, number[]> = {};
  let origins = 0;
  let beats = 0;
  for (let o = minContext; o + horizon <= values.length; o += 1) {
    const ctx = values.slice(0, o);
    const act = values.slice(o, o + horizon);
    origins += 1;
    const originErr: Record<string, number> = {};
    for (const [name, f] of Object.entries(methods)) {
      const fc = f(ctx, horizon);
      const e = mae(act, fc);
      originErr[name] = e;
      (errs[name] ??= []).push(e);
      (sm[name] ??= []).push(smape(act, fc));
      const m = mase(act, fc, ctx);
      if (m !== null) (ms[name] ??= []).push(m);
    }
    if (candidate && originErr[candidate]! < originErr.naive! - 1e-9) beats += 1;
  }
  if (origins === 0) return null;
  const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  return {
    origins,
    horizon,
    mae: Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, round(avg(v))])),
    smape: Object.fromEntries(Object.entries(sm).map(([k, v]) => [k, round(avg(v))])),
    mase: Object.fromEntries(Object.keys(methods).map((k) => [k, ms[k]?.length ? round(avg(ms[k]!)) : null])),
    candidateBeatsNaive: candidate ? round(beats / origins) : null,
  };
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// ── Significance of change in a share ─────────────────────────────────────────

/** Standard normal CDF (Abramowitz–Stegun 7.1.26), accurate to ~1e-7. */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/**
 * Two-proportion z-test for p1 (n1) versus p2 (n2), shares in percent. Two-sided p-value.
 * Assumes independent simple random samples — a panel survey with weighting has a design effect,
 * which `designEffect` inflates the variance by (1 = none assumed).
 */
export function twoProportionTest(p1: number, n1: number, p2: number, n2: number, designEffect = 1): { diffPp: number; z: number; p: number } | null {
  if (!(n1 > 0 && n2 > 0)) return null;
  if (!(p1 >= 0 && p1 <= 100 && p2 >= 0 && p2 <= 100)) return null;
  const a = p1 / 100;
  const b = p2 / 100;
  const pooled = (a * n1 + b * n2) / (n1 + n2);
  const se = Math.sqrt(designEffect * pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { diffPp: round((b - a) * 100, 2), z: 0, p: 1 };
  const z = (b - a) / se;
  return { diffPp: round((b - a) * 100, 2), z: round(z, 3), p: round(2 * (1 - normCdf(Math.abs(z))), 5) };
}

/**
 * Benjamini–Hochberg: which of `pValues` are significant at false-discovery rate `q`. Testing
 * hundreds of series at 0.05 each would otherwise report dozens of "changes" by chance alone.
 */
export function benjaminiHochberg(pValues: readonly number[], q = 0.05): boolean[] {
  const m = pValues.length;
  // A missing or non-finite p is treated as 1: never significant, and it cannot break the sort.
  const order = pValues.map((p, i) => [Number.isFinite(p) ? p : 1, i] as const).sort((x, y) => x[0] - y[0]);
  let k = -1;
  order.forEach(([p], rank) => {
    if (p <= ((rank + 1) / m) * q) k = rank;
  });
  const out = Array(m).fill(false) as boolean[];
  for (let r = 0; r <= k; r += 1) out[order[r]![1]] = true;
  return out;
}
