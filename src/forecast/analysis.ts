/**
 * Trend and forecast analysis of a dataset version (server only).
 *
 * Order of work, which is also the order of authority:
 *   1. Build series from the stored table; never fill a gap.
 *   2. Backtest classical baselines (and TimesFM, if a sidecar is configured) by rolling origin.
 *   3. Run the §24.8 gate. It decides whether any forecast may be shown.
 *   4. Always classify trends with significance testing — the gate's designed alternative, and
 *      useful context even when a forecast is allowed.
 *   5. Only if the gate passed: forecast with the method that won the backtest, with bands from
 *      its own backtest residuals (or the model's quantiles).
 */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { readVersionTables } from '@/ingest/structured';
import { enqueue } from '@/queue/queue';
import { recordAudit } from '@/lib/audit';
import { datasetEmitter } from '@/telemetry/emit';
import { evaluateGate, stepMonths, type ForecastModelSpec, type GateVerdict } from './gate';
import { baselineForecast, rollingBacktest, type BacktestResult, type Forecaster, type Series } from './stats';
import { classifyTrends, DEFAULT_TREND } from './trend';
import { isLongSurveyTable, seriesFromLongTable } from './series';
import { timesfmApproved, timesfmConfigured, timesfmForecast, timesfmHealthy } from './timesfm';

export const DEFAULT_GROUPS = ['all', 'age groups'] as const;
const MAX_SERIES = 20_000;
const MAX_STORED_TRENDS = 6_000;

export async function requestForecastAnalysis(
  user: SessionUser,
  projectId: string,
  datasetVersionId: string,
  opts: { horizon?: number; groups?: string[] } = {},
): Promise<{ analysisId: string }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'dataset.upload', projectId)) throw new AuthorizationError('dataset.upload', projectId);
  const v = await prisma.datasetVersion.findFirst({
    where: { id: datasetVersionId, dataset: { projects: { some: { projectId } } } },
    select: { id: true },
  });
  if (!v) throw new AuthorizationError('dataset.upload', projectId);

  const horizon = Math.min(8, Math.max(1, Math.floor(opts.horizon ?? 1)));
  const a = await prisma.forecastAnalysis.create({
    data: { projectId, datasetVersionId, horizon, groups: opts.groups ?? [...DEFAULT_GROUPS], createdById: user.userId },
  });
  await enqueue({ kind: 'trend_analysis', input: { analysisId: a.id }, idempotencyKey: `trend:${a.id}` });
  await recordAudit({
    action: 'dataset.trend.requested',
    targetType: 'forecastAnalysis',
    targetId: a.id,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    reason: `Trend and forecast analysis requested (horizon ${horizon})`,
  });
  return { analysisId: a.id };
}

export async function latestForecastAnalysis(user: SessionUser, projectId: string, datasetVersionId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);
  return prisma.forecastAnalysis.findFirst({ where: { projectId, datasetVersionId }, orderBy: { createdAt: 'desc' } });
}

async function modelSpec(): Promise<ForecastModelSpec> {
  if (!timesfmConfigured()) return { name: 'baseline', version: '1', licence: 'code (no weights)', approved: true, reachable: true };
  return { name: 'timesfm-2.5', version: 'google/timesfm-2.5-200m-pytorch', licence: 'Apache-2.0', approved: timesfmApproved(), reachable: await timesfmHealthy() };
}

const BASELINES: Record<string, Forecaster> = {
  naive: (c, h) => baselineForecast('naive', c, h),
  seasonal_naive: (c, h) => baselineForecast('seasonal_naive', c, h),
  drift: (c, h) => baselineForecast('drift', c, h),
  mean: (c, h) => baselineForecast('mean', c, h),
};

/** Mean of per-series backtests, so every series counts once whatever its length. */
function pooledBacktest(series: Series[], horizon: number, methods: Record<string, Forecaster>, candidate?: string): BacktestResult | null {
  const results = series.map((s) => rollingBacktest(s.values, horizon, 3, methods, candidate)).filter((r): r is BacktestResult => r !== null);
  if (results.length === 0) return null;
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000;
  const keys = Object.keys(methods);
  return {
    origins: results[0]!.origins,
    horizon,
    mae: Object.fromEntries(keys.map((k) => [k, avg(results.map((r) => r.mae[k]!))])),
    smape: Object.fromEntries(keys.map((k) => [k, avg(results.map((r) => r.smape[k]!))])),
    mase: Object.fromEntries(keys.map((k) => {
      const xs = results.map((r) => r.mase[k]).filter((x): x is number => x !== null);
      return [k, xs.length ? avg(xs) : null];
    })),
    candidateBeatsNaive: candidate ? avg(results.map((r) => r.candidateBeatsNaive ?? 0)) : null,
  };
}

/**
 * TimesFM as an evaluation method inside the backtest: one batched call per origin, so the model
 * sees exactly the contexts the baselines saw. Evaluation of held-out history is not a forecast
 * of the future, so it does not need the gate — but its result feeds the gate.
 */
async function timesfmBacktest(series: Series[], horizon: number): Promise<{ mae: number; beatsNaive: number; coverage: number } | null> {
  const n = series[0]?.values.length ?? 0;
  let err = 0, naiveErr = 0, count = 0, beats = 0, covered = 0;
  for (let o = 3; o + horizon <= n; o += 1) {
    const ctx = series.map((s) => s.values.slice(0, o));
    const out = await timesfmForecast(ctx, horizon);
    if (!out) return null;
    series.forEach((s, i) => {
      const act = s.values.slice(o, o + horizon);
      const e = act.reduce((acc, a, j) => acc + Math.abs(a - Math.max(0, Math.min(100, out.point[i]![j]!))), 0) / horizon;
      const ne = act.reduce((acc, a) => acc + Math.abs(a - s.values[o - 1]!), 0) / horizon;
      err += e; naiveErr += ne; count += 1;
      if (e < ne - 1e-9) beats += 1;
      if (act.every((a, j) => a >= out.q10[i]![j]! && a <= out.q90[i]![j]!)) covered += 1;
    });
  }
  if (count === 0) return null;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { mae: r(err / count), beatsNaive: r(beats / count), coverage: r(covered / count) };
}

export async function runForecastAnalysis(analysisId: string, correlationId?: string): Promise<{ status: string; gatePassed: boolean; series: number }> {
  const a = await prisma.forecastAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
  await prisma.forecastAnalysis.update({ where: { id: a.id }, data: { status: 'RUNNING' } });
  const emit = await datasetEmitter(a.datasetVersionId, correlationId);
  await emit({ eventType: 'trend.started', stage: 'trend_analysis', status: 'active', message: 'Trend and forecast analysis started.' });

  try {
    const series: Series[] = [];
    let dropped = 0;
    let periods: string[] = [];
    let longTable = false;
    for (const t of await readVersionTables(a.datasetVersionId)) {
      if (!isLongSurveyTable(t.headers)) continue;
      longTable = true;
      const r = seriesFromLongTable(t.headers, t.rows, { groups: a.groups, maxSeries: MAX_SERIES - series.length });
      series.push(...r.series);
      dropped += r.dropped;
      periods = periods.length >= r.periods.length ? periods : r.periods;
    }

    const model = await modelSpec();
    // Series sharing one period grid are gated together; the longest grid is the most generous case.
    const points = series.reduce((m, s) => Math.max(m, s.values.length), 0);
    const gridSeries = series.filter((s) => s.values.length === points);
    const backtest = pooledBacktest(gridSeries, a.horizon, BASELINES);
    const tfm = model.name !== 'baseline' && model.reachable && gridSeries.length ? await timesfmBacktest(gridSeries, a.horizon) : null;

    const gate: GateVerdict = longTable
      ? evaluateGate({
          periods: gridSeries[0]?.periods ?? [],
          stepMonths: stepMonths(gridSeries[0]?.periods ?? []),
          points,
          horizon: a.horizon,
          covariatesRequested: false,
          model,
          backtest,
        })
      : {
          passed: false,
          horizon: a.horizon,
          alternative: 'Upload a longitudinal table (one row per wave, measure and segment, with a share and a base) to classify trends.',
          answers: [{ id: 1, question: 'Is the input genuinely a time series (ordered, regular, same measurement)?', pass: false, detail: 'No wave-by-wave table was found in this version.', failAction: 'Refuse; offer trend classification.' }],
        };

    const trends = classifyTrends(series, DEFAULT_TREND);
    const counts = trends.reduce<Record<string, number>>((m, t) => ({ ...m, [t.classification]: (m[t.classification] ?? 0) + 1 }), {});
    counts.step_break = trends.filter((t) => t.stepBreak && (t.classification === 'rising' || t.classification === 'falling')).length;

    let forecasts: unknown = null;
    if (gate.passed) {
      const best = Object.entries(backtest?.mae ?? {}).sort((x, y) => x[1] - y[1])[0]?.[0] ?? 'naive';
      const useModel = tfm !== null && tfm.mae < (backtest?.mae[best] ?? Infinity) && model.approved;
      if (useModel) {
        const out = await timesfmForecast(series.map((s) => s.values), gate.horizon);
        forecasts = out ? series.slice(0, 500).map((s, i) => ({ key: s.key, method: model.version, point: out.point[i], q10: out.q10[i], q90: out.q90[i] })) : null;
      } else {
        // Empirical band: 10th–90th percentile of this method's one-step backtest errors, pooled.
        const resid: number[] = [];
        for (const s of gridSeries) for (let o = 3; o < s.values.length; o += 1) resid.push(s.values[o]! - BASELINES[best]!(s.values.slice(0, o), 1)[0]!);
        resid.sort((x, y) => x - y);
        const q = (p: number) => resid[Math.min(resid.length - 1, Math.max(0, Math.floor(p * resid.length)))] ?? 0;
        forecasts = series.slice(0, 500).map((s) => {
          const point = BASELINES[best]!(s.values, gate.horizon);
          return { key: s.key, method: best, point, q10: point.map((p) => Math.max(0, p + q(0.1))), q90: point.map((p) => Math.min(100, p + q(0.9))) };
        });
      }
    }

    await prisma.forecastAnalysis.update({
      where: { id: a.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        seriesCount: series.length,
        droppedSeries: dropped,
        periods,
        gatePassed: gate.passed,
        gate: gate as unknown as object,
        backtest: { baselines: backtest, timesfm: tfm, model: { name: model.name, version: model.version, licence: model.licence, approved: model.approved, reachable: model.reachable } } as unknown as object,
        trends: { counts, options: DEFAULT_TREND, rows: trends.slice(0, MAX_STORED_TRENDS), truncated: trends.length > MAX_STORED_TRENDS } as unknown as object,
        forecasts: (forecasts ?? undefined) as object | undefined,
        modelName: model.name,
        modelVersion: model.version,
      },
    });
    await emit({
      eventType: gate.passed ? 'forecast.gate.passed' : 'forecast.gate.refused',
      stage: 'trend_analysis',
      status: gate.passed ? 'completed' : 'warning',
      severity: gate.passed ? 'info' : 'notice',
      message: gate.passed
        ? `Forecast gate passed. ${series.length} series forecast ${gate.horizon} step(s) ahead.`
        : `Forecasting isn't valid here: ${gate.answers.filter((x) => !x.pass).map((x) => `Q${x.id}`).join(', ')} failed. Trend classification produced instead for ${series.length} series.`,
      progressCurrent: series.length,
      safeMetadata: { count: series.length },
    });
    return { status: 'COMPLETED', gatePassed: gate.passed, series: series.length };
  } catch (e) {
    await prisma.forecastAnalysis.update({ where: { id: a.id }, data: { status: 'FAILED', completedAt: new Date(), failureReason: 'The analysis could not be completed. The cause is in the server log.' } });
    await emit({ eventType: 'trend.failed', stage: 'trend_analysis', status: 'failed', severity: 'error', message: 'Trend analysis failed. The cause is in the server log under the correlation id.' });
    throw e;
  }
}
