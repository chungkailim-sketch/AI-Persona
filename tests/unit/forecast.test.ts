import { describe, it, expect } from 'vitest';
import { baselineForecast, benjaminiHochberg, mase, rollingBacktest, twoProportionTest, type Series } from '../../src/forecast/stats';
import { evaluateGate, stepMonths, type ForecastModelSpec } from '../../src/forecast/gate';
import { classifyTrends } from '../../src/forecast/trend';
import { isLongSurveyTable, seriesFromLongTable, BASE_RESPONSE } from '../../src/forecast/series';

const BASELINE: ForecastModelSpec = { name: 'baseline', version: '1', licence: 'code (no weights)', approved: true, reachable: true };
const HEAD = ['market', 'wave', 'wave_year', 'wave_month', 'question_id', 'statement', 'response', 'segment_group', 'segment', 'sample_base', 'share'];
const WAVES: [number, string][] = [[2024, 'March'], [2024, 'September'], [2025, 'March'], [2025, 'September'], [2026, 'March']];

function longRows(values: number[], opts: { response?: string; base?: number; segment?: string } = {}) {
  return WAVES.map(([y, m], i) => ['US', `${m} ${y}`, String(y), m, 'Q1', 'I enjoy taking risks', opts.response ?? 'Agree', 'All', opts.segment ?? 'All', String(opts.base ?? 1000), String(values[i])]);
}

describe('baselines and metrics', () => {
  it('computes naive, mean, drift and seasonal naive', () => {
    const c = [10, 20, 12, 22];
    expect(baselineForecast('naive', c, 2)).toEqual([22, 22]);
    expect(baselineForecast('mean', c, 1)).toEqual([16]);
    expect(baselineForecast('drift', c, 1)[0]).toBeCloseTo(26);
    expect(baselineForecast('seasonal_naive', c, 2)).toEqual([12, 22]);
  });
  it('clamps drift to 0–100', () => {
    expect(baselineForecast('drift', [60, 80, 99], 3)[2]).toBe(100);
  });
  it('MASE is null for a constant history', () => {
    expect(mase([5], [5], [5, 5, 5])).toBeNull();
  });
  it('rolling backtest gives every method the same origins', () => {
    const r = rollingBacktest([1, 2, 3, 4, 5, 6], 1, 3, { naive: (c, h) => baselineForecast('naive', c, h), drift: (c, h) => baselineForecast('drift', c, h) }, 'drift');
    expect(r?.origins).toBe(3);
    expect(r?.mae.drift).toBe(0);
    expect(r?.candidateBeatsNaive).toBe(1);
  });
});

describe('significance', () => {
  it('two-proportion test detects a large change and not a tiny one', () => {
    expect(twoProportionTest(30, 1000, 19, 1000, 1.5)!.p).toBeLessThan(0.001);
    expect(twoProportionTest(30, 1000, 31, 1000, 1.5)!.p).toBeGreaterThan(0.5);
  });
  it('refuses a value that is not a percentage', () => {
    expect(twoProportionTest(30, 1000, 71000, 1000)).toBeNull();
  });
  it('Benjamini–Hochberg controls false discoveries and ignores NaN', () => {
    expect(benjaminiHochberg([0.001, 0.02, 0.04, 0.5], 0.05)).toEqual([true, true, false, false]);
    expect(benjaminiHochberg([Number.NaN, 0.001, 0.059], 0.05)).toEqual([false, true, false]);
  });
});

describe('forecast gate (PRD §24.8)', () => {
  const periods = WAVES.map(([y, m]) => `${m} ${y}`);
  it('refuses five semi-annual waves and names the reasons', () => {
    const v = evaluateGate({ periods, stepMonths: stepMonths(periods), points: 5, horizon: 1, covariatesRequested: false, model: BASELINE, backtest: null });
    expect(v.passed).toBe(false);
    const failed = v.answers.filter((a) => !a.pass).map((a) => a.id);
    expect(failed).toContain(2);
    expect(failed).toContain(6);
    expect(v.alternative).toMatch(/trend classification/i);
  });
  it('blocks a non-commercial model licence', () => {
    const long = Array.from({ length: 12 }, (_, i) => `${i % 2 ? 'September' : 'March'} ${2020 + Math.floor(i / 2)}`);
    const bt = rollingBacktest(Array.from({ length: 12 }, (_, i) => 20 + i), 1, 3, { naive: (c, h) => baselineForecast('naive', c, h) });
    const v = evaluateGate({ periods: long, stepMonths: stepMonths(long), points: 12, horizon: 1, covariatesRequested: false, model: { name: 'timesfm-3.0', version: '3', licence: 'non-commercial', approved: false, reachable: true }, backtest: bt });
    expect(v.answers.find((a) => a.id === 8)!.pass).toBe(false);
    expect(v.passed).toBe(false);
  });
});

describe('series from a long survey table', () => {
  it('recognises the shape and drops base rows', () => {
    expect(isLongSurveyTable(HEAD)).toBe(true);
    expect(BASE_RESPONSE.test('Sample')).toBe(true);
    const rows = [...longRows([30, 18, 15, 17, 19]), ...longRows([71000, 71000, 71000, 71000, 71000], { response: 'Sample' })];
    const r = seriesFromLongTable(HEAD, rows);
    expect(r.series).toHaveLength(1);
    expect(r.series[0]!.values).toEqual([30, 18, 15, 17, 19]);
    expect(r.periods).toHaveLength(5);
  });
  it('drops a series with a missing wave instead of filling it', () => {
    const rows = longRows([30, 18, 15, 17, 19]).slice(0, 4).concat(longRows([10, 11, 12, 13, 14], { segment: '18-24' }));
    const r = seriesFromLongTable(HEAD, rows);
    expect(r.series).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });
});

describe('trend classification', () => {
  const s = (key: string, values: number[], base = 1000): Series => ({ key, label: key, periods: WAVES.map(([y, m]) => `${m} ${y}`), values, bases: values.map(() => base), group: 'All', segment: 'All' });
  it('classifies rising, falling, no change and untestable', () => {
    const rows = classifyTrends([s('fall', [30, 18, 15, 17, 19]), s('rise', [10, 12, 15, 18, 22]), s('flat', [40, 41, 40, 39, 41]), { ...s('nobase', [10, 20, 30, 40, 50]), bases: [null, null, null, null, null] }]);
    const by = Object.fromEntries(rows.map((r) => [r.key, r.classification]));
    expect(by).toEqual({ fall: 'falling', rise: 'rising', flat: 'no_detectable_change', nobase: 'untestable' });
  });
  it('a change below the practical threshold is not a change, however significant', () => {
    const [r] = classifyTrends([s('tiny', [50, 50, 50, 50, 52], 100000)]);
    expect(r!.classification).toBe('no_detectable_change');
    expect(r!.reason).toMatch(/practical threshold/);
  });
});

describe('step-break flag', () => {
  it('flags a one-step jump and not a gradual trend', async () => {
    const { isStepBreak } = await import('../../src/forecast/trend');
    expect(isStepBreak([60, 30, 31, 30, 32])).toBe(true);
    expect(isStepBreak([20, 26, 32, 38, 44])).toBe(false);
    expect(isStepBreak([40, 41, 40, 42, 43])).toBe(false);
  });
});
