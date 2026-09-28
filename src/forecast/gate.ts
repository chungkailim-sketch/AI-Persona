/**
 * The forecasting decision gate (PRD §24.8, FR-51). Ten questions, answered in code before any
 * forecast is produced; the answers are stored with the analysis. One failure refuses the forecast
 * and the refusal names the alternative — refusal is a designed outcome, not an error.
 */
import type { BacktestResult } from './stats';

export interface ForecastModelSpec {
  name: 'baseline' | 'timesfm-2.5' | 'timesfm-3.0';
  version: string;
  licence: string;
  /** Recorded legal and technical approval for this deployment (env TIMESFM_APPROVED). */
  approved: boolean;
  /** A forecasting service is configured and answered its health check. */
  reachable: boolean;
}

export interface GateInput {
  periods: string[];
  /** Months between consecutive periods, as parsed; null when a period could not be parsed. */
  stepMonths: (number | null)[];
  points: number;
  horizon: number;
  covariatesRequested: boolean;
  model: ForecastModelSpec;
  backtest: BacktestResult | null;
}

export interface GateAnswer {
  id: number;
  question: string;
  pass: boolean;
  detail: string;
  failAction: string;
}

export interface GateVerdict {
  passed: boolean;
  answers: GateAnswer[];
  /** Horizon after any cap applied by question 3. */
  horizon: number;
  alternative: string | null;
}

export const GATE_RULES = {
  /** Minimum history, whatever the horizon: fewer points cannot support a backtest with several origins. */
  minPoints: 8,
  /** History must be at least this multiple of the horizon. */
  historyPerHorizonStep: 3,
  minBacktestOrigins: 3,
  approvedLicences: ['Apache-2.0', 'code (no weights)'],
} as const;

export const ALTERNATIVE =
  'Trend classification with significance testing: each tracked measure is classified as rising, falling or ' +
  'no detectable change between waves, using two-proportion tests on the published bases with a false-discovery-rate correction.';

export function evaluateGate(input: GateInput): GateVerdict {
  const a: GateAnswer[] = [];
  const steps = input.stepMonths.slice(1);
  const regular = steps.length > 0 && steps.every((s) => s !== null && s > 0 && s === steps[0]);
  a.push({
    id: 1,
    question: 'Is the input genuinely a time series (ordered, regular, same measurement)?',
    pass: regular,
    detail: regular ? `${input.points} periods, every ${steps[0]} months, one measure.` : 'Periods are missing, unordered or irregularly spaced.',
    failAction: 'Refuse; offer trend classification.',
  });

  const needed = Math.max(GATE_RULES.minPoints, input.horizon * GATE_RULES.historyPerHorizonStep);
  a.push({
    id: 2,
    question: 'Is there sufficient history and stable granularity for the horizon?',
    pass: input.points >= needed,
    detail: `${input.points} points available; ${needed} needed for a ${input.horizon}-step horizon.`,
    failAction: `Refuse; state points needed (${needed}).`,
  });

  const maxH = Math.max(0, Math.floor(input.points / GATE_RULES.historyPerHorizonStep));
  const horizon = Math.min(input.horizon, maxH);
  a.push({
    id: 3,
    question: 'Is the requested horizon defensible relative to history?',
    pass: horizon >= 1,
    detail: horizon === input.horizon ? `Horizon ${input.horizon} is within ${maxH}.` : horizon >= 1 ? `Horizon capped from ${input.horizon} to ${horizon}.` : 'No horizon is defensible on this history.',
    failAction: 'Cap the horizon or refuse.',
  });

  a.push({
    id: 4,
    question: 'Are covariates required, and are they available without leakage?',
    pass: !input.covariatesRequested,
    detail: input.covariatesRequested ? 'Covariates were requested; none are wired without a leakage review.' : 'Univariate: no covariates, so no leakage path.',
    failAction: 'Refuse or drop covariates.',
  });

  a.push({
    id: 5,
    question: 'Which baselines will it be compared against?',
    pass: true,
    detail: 'Naive (last value), seasonal naive (same season last year), drift, and the history mean.',
    failAction: 'Mandatory; no baseline, no forecast.',
  });

  const origins = input.backtest?.origins ?? 0;
  a.push({
    id: 6,
    question: 'How is backtesting performed?',
    pass: origins >= GATE_RULES.minBacktestOrigins,
    detail: origins >= GATE_RULES.minBacktestOrigins
      ? `Rolling origin, ${origins} origins, horizon ${input.backtest!.horizon}.`
      : `Rolling origin needs at least ${GATE_RULES.minBacktestOrigins} origins; this history allows ${origins}.`,
    failAction: 'Mandatory.',
  });

  a.push({
    id: 7,
    question: 'Which error metrics apply?',
    pass: true,
    detail: 'MASE (scaled by in-sample naive error), sMAPE, and pinball loss for interval quantiles.',
    failAction: 'Mandatory.',
  });

  const licenced = (GATE_RULES.approvedLicences as readonly string[]).includes(input.model.licence) && (input.model.name === 'baseline' || input.model.approved);
  a.push({
    id: 8,
    question: 'Is the model and version licensed for this commercial deployment?',
    pass: licenced,
    detail: input.model.name === 'baseline'
      ? 'Classical baselines computed in code; no third-party weights.'
      : input.model.name === 'timesfm-3.0'
        ? 'TimesFM 3.0 weights are under a non-commercial licence; not permitted.'
        : input.model.approved
          ? `${input.model.name} (${input.model.licence}) with recorded legal and technical approval.`
          : `${input.model.name} is ${input.model.licence}, but no legal and technical approval is recorded for this deployment.`,
    failAction: 'Blocked pending legal (U3).',
  });

  a.push({
    id: 9,
    question: 'Does it fit Railway resource limits?',
    pass: input.model.name === 'baseline' || input.model.reachable,
    detail: input.model.name === 'baseline' ? 'Runs in the worker; negligible cost.' : input.model.reachable ? 'Forecasting service reachable.' : 'No forecasting service is configured or it did not answer.',
    failAction: 'Blocked pending technical review.',
  });

  a.push({
    id: 10,
    question: 'What uncertainty and limitations will be displayed?',
    pass: true,
    detail: 'Prediction bands from backtest residual quantiles (or model quantiles), the backtest table, and the gate record.',
    failAction: 'Mandatory.',
  });

  const passed = a.every((x) => x.pass);
  return { passed, answers: a, horizon, alternative: passed ? null : ALTERNATIVE };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "March 2024" → months since year 0; null if it cannot be parsed. */
export function periodIndex(label: string): number | null {
  const m = /([A-Za-z]+)\s+(\d{4})/.exec(label);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1]!.toLowerCase());
  return mi < 0 ? null : Number(m[2]) * 12 + mi;
}

export function stepMonths(periods: readonly string[]): (number | null)[] {
  const idx = periods.map(periodIndex);
  return idx.map((v, i) => (i === 0 ? 0 : v === null || idx[i - 1] === null ? null : v - idx[i - 1]!));
}
