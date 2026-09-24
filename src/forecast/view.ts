/**
 * Shape a stored ForecastAnalysis for the browser: the gate, the backtest, classification counts,
 * and a bounded set of trend rows (largest significant changes first). Server only.
 */
import type { TrendRow } from './trend';

const ROW_CAP = 500;

type Stored = {
  id: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  horizon: number;
  groups: string[];
  seriesCount: number | null;
  droppedSeries: number | null;
  periods: string[];
  gatePassed: boolean | null;
  gate: unknown;
  backtest: unknown;
  trends: unknown;
  failureReason: string | null;
};

export function trendAnalysisView(a: Stored) {
  const t = (a.trends ?? null) as { counts: Record<string, number>; options: { fdr: number; minPracticalPp: number; designEffect: number }; rows: TrendRow[] } | null;
  const all = t?.rows ?? [];
  const mag = (r: TrendRow) => Math.abs(r.overallDiffPp ?? 0);
  const sig = all.filter((r) => r.classification === 'rising' || r.classification === 'falling').sort((x, y) => mag(y) - mag(x));
  const rest = all.filter((r) => r.classification !== 'rising' && r.classification !== 'falling').sort((x, y) => mag(y) - mag(x));
  const rows = [...sig.slice(0, ROW_CAP - 100), ...rest.slice(0, 100)].map((r) => ({
    key: r.key,
    label: r.label,
    group: r.group,
    segment: r.segment,
    periods: r.periods,
    values: r.values,
    overallDiffPp: r.overallDiffPp,
    recentDiffPp: r.recentDiffPp,
    classification: r.classification,
    recentClassification: r.recentClassification,
    stepBreak: Boolean(r.stepBreak),
    reason: r.reason,
  }));
  return {
    id: a.id,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    completedAt: a.completedAt?.toISOString() ?? null,
    horizon: a.horizon,
    groups: a.groups,
    seriesCount: a.seriesCount,
    droppedSeries: a.droppedSeries,
    periods: a.periods,
    gatePassed: a.gatePassed,
    gate: (a.gate ?? null) as never,
    backtest: (a.backtest ?? null) as never,
    counts: t?.counts ?? {},
    rows,
    rowsTotal: all.length,
    trendOptions: t?.options ?? null,
    failureReason: a.failureReason,
  };
}
