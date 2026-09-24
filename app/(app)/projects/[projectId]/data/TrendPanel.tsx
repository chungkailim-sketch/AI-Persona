'use client';

import { useActionState, useMemo, useState } from 'react';
import { requestTrendAnalysisAction, type FormState } from '../actions';
import { Field, FormMessages, Select, SubmitButton, TextInput } from '@/ui/forms';

export interface GateAnswerView {
  id: number;
  question: string;
  pass: boolean;
  detail: string;
  failAction: string;
}

export interface TrendRowView {
  key: string;
  label: string;
  group: string;
  segment: string;
  periods: string[];
  values: number[];
  overallDiffPp: number | null;
  recentDiffPp: number | null;
  classification: string;
  recentClassification: string;
  stepBreak: boolean;
  reason: string;
}

export interface TrendAnalysisView {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  horizon: number;
  groups: string[];
  seriesCount: number | null;
  droppedSeries: number | null;
  periods: string[];
  gatePassed: boolean | null;
  gate: { passed: boolean; horizon: number; alternative: string; answers: GateAnswerView[] } | null;
  backtest: {
    baselines: { origins: number; horizon: number; mae: Record<string, number>; smape: Record<string, number>; mase: Record<string, number | null> } | null;
    timesfm: { mae: number; beatsNaive: number; coverage: number } | null;
    model: { name: string; version: string; licence: string; approved: boolean; reachable: boolean };
  } | null;
  counts: Record<string, number>;
  rows: TrendRowView[];
  rowsTotal: number;
  trendOptions: { fdr: number; minPracticalPp: number; designEffect: number } | null;
  failureReason: string | null;
}

const empty: FormState = {};

const CLASS_LABEL: Record<string, string> = {
  rising: 'Rising',
  falling: 'Falling',
  no_detectable_change: 'No detectable change',
  untestable: 'Untestable',
};
const CLASS_TONE: Record<string, string> = {
  rising: 'border-ok/40 bg-ok-soft text-ok',
  falling: 'border-danger/40 bg-danger-soft text-danger',
  no_detectable_change: 'border-line text-ink-muted',
  untestable: 'border-warn/40 bg-warn-soft text-warn',
};
const METHOD_LABEL: Record<string, string> = {
  naive: 'Naive (last wave)',
  seasonal_naive: 'Seasonal naive (same month, prior year)',
  drift: 'Drift (first-to-last slope)',
  mean: 'History mean',
};

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 72;
  const h = 20;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="text-ink-muted">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function fmtPp(v: number | null) {
  if (v === null) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

export function TrendRequestForm({ projectId, datasetVersionId, groups }: { projectId: string; datasetVersionId: string; groups: string[] }) {
  const [state, action] = useActionState(requestTrendAnalysisAction, empty);
  const choices = groups.length ? groups : ['All', 'Age groups'];
  const defaults = new Set(['all', 'age groups']);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="datasetVersionId" value={datasetVersionId} />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium text-ink">Segment groups to analyse</legend>
        <p className="text-xs text-ink-subtle">Each statement × response × segment becomes one series. More groups mean more tests, and the false-discovery correction accounts for every one.</p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {choices.map((g) => (
            <label key={g} className="flex items-center gap-1.5 text-sm text-ink">
              <input type="checkbox" name="groups" value={g.toLowerCase()} defaultChecked={defaults.has(g.toLowerCase())} />
              {g}
            </label>
          ))}
        </div>
      </fieldset>
      <Field id="trend-horizon" label="Forecast horizon (waves ahead)" hint="Used only by the forecast gate. Trend classification needs no horizon.">
        <Select id="trend-horizon" name="horizon" defaultValue="1">
          {[1, 2, 3, 4].map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </Select>
      </Field>
      <FormMessages state={state} />
      <div>
        <SubmitButton pendingLabel="Queuing…">Run trend analysis and forecast gate</SubmitButton>
      </div>
    </form>
  );
}

export function TrendResults({ analysis }: { analysis: TrendAnalysisView }) {
  const [filter, setFilter] = useState<'significant' | 'rising' | 'falling' | 'all'>('significant');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(25);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return analysis.rows
      .filter((r) => (filter === 'all' ? true : filter === 'significant' ? r.classification === 'rising' || r.classification === 'falling' : r.classification === filter))
      .filter((r) => !needle || r.label.toLowerCase().includes(needle) || r.segment.toLowerCase().includes(needle))
      ;
  }, [analysis.rows, filter, q]);
  const shown = rows.slice(0, limit);

  if (analysis.status === 'QUEUED' || analysis.status === 'RUNNING') {
    return <p className="rounded border border-info/40 bg-info-soft px-3 py-2 text-sm text-ink">Analysis {analysis.status.toLowerCase()}. Refresh when the activity log shows it has finished.</p>;
  }
  if (analysis.status === 'FAILED') {
    return <p className="rounded border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">{analysis.failureReason ?? 'The analysis failed.'}</p>;
  }

  const failed = analysis.gate?.answers.filter((a) => !a.pass) ?? [];
  const bt = analysis.backtest;

  return (
    <div className="flex flex-col gap-5">
      {/* Gate verdict */}
      {analysis.gate && (
        <div>
          {analysis.gate.passed ? (
            <p className="rounded border border-ok/40 bg-ok-soft px-3 py-2 text-sm text-ok">
              Forecast gate passed for a {analysis.gate.horizon}-wave horizon. Forecasts use the method that won the backtest, with bands from its own errors.
            </p>
          ) : (
            <p role="status" className="rounded border border-warn/40 bg-warn-soft/60 px-3 py-2 text-sm text-ink">
              <strong className="font-medium">Forecasting isn&rsquo;t valid here:</strong>{' '}
              {failed.map((a) => a.detail).join(' ')} We can show trend classification instead — it is below.
              <span className="mt-1 block text-xs text-ink-muted">This is a designed outcome, not an error (PRD §24.8). {analysis.gate.alternative}</span>
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-brand">The ten gate questions and their answers</summary>
            <ol className="mt-2 flex flex-col gap-1.5">
              {analysis.gate.answers.map((a) => (
                <li key={a.id} className="flex gap-2 text-xs">
                  <span className={`shrink-0 rounded-sm border px-1.5 font-mono ${a.pass ? 'border-ok/40 bg-ok-soft text-ok' : 'border-danger/40 bg-danger-soft text-danger'}`}>
                    Q{a.id} {a.pass ? 'pass' : 'fail'}
                  </span>
                  <span className="text-ink-muted">
                    <span className="text-ink">{a.question}</span> {a.detail}
                    {!a.pass && <span className="text-ink-subtle"> On failure: {a.failAction}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}

      {/* Backtest */}
      {bt?.baselines && (
        <div>
          <h4 className="text-sm font-medium text-ink">Backtest (rolling origin, {bt.baselines.origins} origin{bt.baselines.origins === 1 ? '' : 's'}, {bt.baselines.horizon}-wave horizon)</h4>
          <p className="text-xs text-ink-subtle">Error in percentage points on held-out waves. MASE below 1 beats the naive forecast. With this few origins the table is evidence about the history, not a validated forecaster.</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-ink-subtle">
                <tr><th className="py-1 pr-3 font-normal">Method</th><th className="py-1 pr-3 font-normal">MAE (pp)</th><th className="py-1 pr-3 font-normal">sMAPE (%)</th><th className="py-1 font-normal">MASE</th></tr>
              </thead>
              <tbody className="font-mono text-ink">
                {Object.keys(bt.baselines.mae).map((k) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1 pr-3 font-sans">{METHOD_LABEL[k] ?? k}</td>
                    <td className="py-1 pr-3">{bt.baselines!.mae[k]!.toFixed(2)}</td>
                    <td className="py-1 pr-3">{bt.baselines!.smape[k]!.toFixed(1)}</td>
                    <td className="py-1">{bt.baselines!.mase[k] == null ? '—' : bt.baselines!.mase[k]!.toFixed(2)}</td>
                  </tr>
                ))}
                {bt.timesfm && (
                  <tr className="border-t border-line">
                    <td className="py-1 pr-3 font-sans">TimesFM 2.5 (evaluation only{bt.model.approved ? '' : ', not approved for forecasts'})</td>
                    <td className="py-1 pr-3">{bt.timesfm.mae.toFixed(2)}</td>
                    <td className="py-1 pr-3" colSpan={2}>beats naive on {(bt.timesfm.beatsNaive * 100).toFixed(0)}% · q10–q90 coverage {(bt.timesfm.coverage * 100).toFixed(0)}%</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-ink-subtle">
            Model: {bt.model.name === 'baseline' ? 'classical baselines computed in code' : `${bt.model.version} (${bt.model.licence}; ${bt.model.reachable ? 'reachable' : 'not reachable'}; ${bt.model.approved ? 'approved' : 'awaiting legal and technical approval'})`}.
          </p>
        </div>
      )}

      {/* Trend classification */}
      <div>
        <h4 className="text-sm font-medium text-ink">Trend classification — {analysis.periods[0]} to {analysis.periods[analysis.periods.length - 1]}</h4>
        <p className="text-xs text-ink-subtle">
          First wave against latest, two-proportion test on the published bases
          {analysis.trendOptions && ` (design effect ${analysis.trendOptions.designEffect}, false-discovery rate ${analysis.trendOptions.fdr}, practical threshold ${analysis.trendOptions.minPracticalPp} pp)`}.
          {' '}{analysis.seriesCount?.toLocaleString()} complete series tested; {analysis.droppedSeries?.toLocaleString()} with a missing wave were dropped, never filled.
        </p>
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Classification counts">
          {['rising', 'falling', 'no_detectable_change', 'untestable'].map((k) => (
            <li key={k} className={`rounded-sm border px-2 py-0.5 font-mono text-[11px] ${CLASS_TONE[k]}`}>{CLASS_LABEL[k]} {(analysis.counts[k] ?? 0).toLocaleString()}</li>
          ))}
        </ul>
        {(analysis.counts.step_break ?? 0) > 0 && (
          <p className="mt-2 rounded border border-warn/40 bg-warn-soft/50 px-3 py-2 text-xs text-ink">
            {(analysis.counts.step_break ?? 0).toLocaleString()} of the significant changes happened mostly in a single wave-to-wave step. A trend is gradual; a one-step
            jump is more often a questionnaire, translation, scale or panel change. Check the supplier&rsquo;s methodology notes for those waves before reporting them as consumer change.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field id="trend-filter" label="Show">
            <Select id="trend-filter" value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setLimit(25); }}>
              <option value="significant">Significant changes</option>
              <option value="rising">Rising only</option>
              <option value="falling">Falling only</option>
              <option value="all">All stored rows</option>
            </Select>
          </Field>
          <Field id="trend-q" label="Search statement or segment">
            <TextInput id="trend-q" value={q} onChange={(e) => { setQ(e.target.value); setLimit(25); }} placeholder="e.g. heritage, 18-24" />
          </Field>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Trend classification by series</caption>
            <thead className="text-ink-subtle">
              <tr>
                <th className="py-1 pr-3 font-normal">Series</th>
                <th className="py-1 pr-3 font-normal">Segment</th>
                <th className="py-1 pr-3 font-normal">Waves</th>
                <th className="py-1 pr-3 font-normal">Change (pp)</th>
                <th className="py-1 pr-3 font-normal">Latest step (pp)</th>
                <th className="py-1 font-normal">Classification</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className="border-t border-line align-top">
                  <td className="max-w-[26rem] py-1.5 pr-3 text-ink" title={r.reason}>{r.label}</td>
                  <td className="py-1.5 pr-3 text-ink-muted">{r.segment}</td>
                  <td className="py-1.5 pr-3">
                    <Sparkline values={r.values} />
                    <span className="sr-only">{r.periods.map((p, i) => `${p}: ${r.values[i]}%`).join(', ')}</span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-ink">{fmtPp(r.overallDiffPp)}</td>
                  <td className="py-1.5 pr-3 font-mono text-ink-muted">{fmtPp(r.recentDiffPp)} <span className="font-sans text-[10px]">({CLASS_LABEL[r.recentClassification]?.toLowerCase()})</span></td>
                  <td className="py-1.5">
                    <span className={`rounded-sm border px-1.5 font-mono text-[10.5px] ${CLASS_TONE[r.classification]}`}>{CLASS_LABEL[r.classification]}</span>
                    {r.stepBreak && (r.classification === 'rising' || r.classification === 'falling') && (
                      <span className="ml-1 rounded-sm border border-warn/40 bg-warn-soft px-1.5 font-mono text-[10.5px] text-warn" title="Most of the change happened in one step. Check for a questionnaire or panel change.">one-step jump</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-3 text-sm text-ink-muted">No series match.</p>}
          {rows.length > shown.length && (
            <button type="button" onClick={() => setLimit((l) => l + 50)} className="mt-2 text-xs text-brand underline-offset-2 hover:underline">
              Show 50 more ({(rows.length - shown.length).toLocaleString()} matching rows not shown)
            </button>
          )}
          {analysis.rows.length < analysis.rowsTotal && (
            <p className="mt-1 text-[11px] text-ink-subtle">Showing the {analysis.rows.length.toLocaleString()} largest changes of {analysis.rowsTotal.toLocaleString()} stored rows; counts above cover every series.</p>
          )}
        </div>
      </div>
    </div>
  );
}
