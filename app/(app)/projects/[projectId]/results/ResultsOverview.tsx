import { MetricCard, MetricGrid } from '@/ui/components/MetricCard';
import { PassFlagFailSummary } from '@/ui/components/PassFlagFailSummary';
import { SegmentDistributionBar } from '@/ui/components/SegmentDistributionBar';
import { FindingSeverityBadge } from '@/ui/components/FindingSeverityBadge';
import { StatusBadge } from '@/ui/components/StatusBadge';
import { findingSeverity, NODE_STATUS_META } from '@/telemetry/status';
import type { AssembledReport } from '@/report/assemble';
import { nextExperiments, type resultsSummary } from '@/report/summary';

type Summary = Awaited<ReturnType<typeof resultsSummary>>;

const CLASS_WORD: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  PROBABLE: 'Probable',
  CONTESTED: 'Contested',
  MINORITY_RETAINED: 'Minority retained',
  DISCARDED: 'Discarded',
};

export function ResultsOverview({ report, summary }: { report: AssembledReport; summary: Summary }) {
  const f = report.findings[0];
  const support = f?.consensusRatio ?? null;
  const moved = summary.rows.filter((r) => r.moved).length;

  return (
    <div className="flex flex-col gap-4">
      <MetricGrid label="Result summary">
        <MetricCard compact label="Classification" value={f?.classification ? CLASS_WORD[f.classification] ?? f.classification : null} tone={f?.classification === 'PROBABLE' ? 'ok' : f?.classification === 'DISCARDED' ? 'neutral' : 'warn'} definition="Computed from the final stance distribution and the anti-herding check. A persona panel can never reach Confirmed." />
        <MetricCard compact label="Support" value={support === null ? null : `${Math.round(support * 100)}%`} definition="Share of the panel supporting the claim after the challenge round." />
        <MetricCard compact label="Weighted support" value={summary.weightedSupport === null ? null : `${summary.weightedSupport}%`} definition={`Support with each persona weighted by its segment's share of the survey sample (independent round: ${summary.weightedIndependentSupport ?? '—'}%). Weighted by survey-sample segment share, not census population.`} />
        <MetricCard compact label="Panel" value={report.panelSize} definition="Personas whose answers were usable." />
        <MetricCard compact label="Moved position" value={moved} tone={moved > 0 ? 'warn' : undefined} definition="Personas whose stance changed between the independent round and the end." />
        <MetricCard compact label="Evidence grade" value="L3" definition="Persona simulation. The ceiling for anything this method produces." />
        <MetricCard compact label="Recorded spend" value={`$${report.spendUsd.toFixed(4)}`} definition={`${report.callCount} model calls recorded.`} />
      </MetricGrid>

      <div className="grid gap-3 lg:grid-cols-3">
        <PassFlagFailSummary pass={summary.verdicts.pass} flag={summary.verdicts.flag} fail={summary.verdicts.fail} title="Answer evaluation (final)" />
        <SegmentDistributionBar title="Stances · independent round" rows={summary.independent} caption="Before anyone saw another view — the only round that carries information about agreement." />
        <SegmentDistributionBar title="Stances · after challenge" rows={summary.final} caption="After the challenge round. Compare with the independent round." />
      </div>

      <section aria-labelledby="segments-title" className="flex flex-col gap-2">
        <h2 id="segments-title" className="text-lg">Segment comparison</h2>
        <div className="max-w-prose text-xs text-ink-subtle">
          <p>
            One row per persona, showing how the engine reached its position. Each persona first answered the hypothesis
            alone, grounded in its segment&rsquo;s published shares from the cleared data and citing the evidence fields it
            relied on. The engine then took the independent majority and had at least half the panel argue against it; every
            persona reconsidered in the light of those challenges. The run&rsquo;s classification comes from the final split
            and the anti-herding check — support that only appears after exposure counts for less than support given alone.
          </p>
          <p className="mt-1">
            &ldquo;Key explanation&rdquo; gives each persona&rsquo;s stated reasoning, whether and why it moved, and the base behind it.
            These are simulated positions, not measurements, so no significance test is applied to them.
          </p>
        </div>
        <div className="panel overflow-x-auto" tabIndex={0} role="region" aria-label="Segment comparison table">
          <table className="w-full min-w-[46rem] text-left text-[12.5px]">
            <caption className="sr-only">Segment comparison: independent and final stance per persona, with base, confidence and status</caption>
            <thead className="border-b border-line text-ink-subtle">
              <tr>
                {['Segment', 'Independent', 'Final position', 'Base', 'Confidence', 'Status', 'Key explanation'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <tr key={r.persona} className="border-b border-line/70 align-top">
                  <th scope="row" className="px-3 py-2 font-normal text-ink">{r.segment}</th>
                  <td className="px-3 py-2 font-mono">{r.independent ?? '—'}</td>
                  <td className="px-3 py-2 font-mono">{r.final ?? '—'}{r.moved && <span className="ml-1 text-warn">(moved)</span>}</td>
                  <td className="px-3 py-2 font-mono">{r.baseSize ?? '—'}</td>
                  <td className="px-3 py-2">{r.confidence.toLowerCase()}</td>
                  <td className="px-3 py-2">
                    {r.dissenting ? <StatusBadge size="xs" meta={NODE_STATUS_META.warning} label="Dissent" /> : <StatusBadge size="xs" meta={NODE_STATUS_META.completed} label="Majority" />}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{r.explanation}</td>
                </tr>
              ))}
              {summary.rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-4 text-xs text-ink-subtle">No persona positions were recorded for this run.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {f && (
        <section aria-labelledby="finding-table-title" className="flex flex-col gap-2">
          <h2 id="finding-table-title" className="text-lg">Findings at a glance</h2>
          <div className="panel overflow-x-auto" tabIndex={0} role="region" aria-label="Findings table">
            <table className="w-full min-w-[52rem] text-left text-[12.5px]">
              <caption className="sr-only">Findings with severity, evidence, segment, variant, confidence, caveat and recommendation</caption>
              <thead className="border-b border-line text-ink-subtle">
                <tr>
                  {['Severity', 'Finding', 'Evidence', 'Affected segments', 'Variant', 'Confidence', 'Caveat', 'Recommendation'].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.findings.map((x) => {
                  const sev = findingSeverity({ severity: null, classification: x.classification, groupthink: report.groupthinkWarning });
                  return (
                    <tr key={x.id} className="border-b border-line/70 align-top">
                      <td className="whitespace-nowrap px-3 py-2"><FindingSeverityBadge level={sev.level} derived={sev.derived} /></td>
                      <th scope="row" className="px-3 py-2 font-normal text-ink">{x.title}</th>
                      <td className="px-3 py-2">L3 simulation · {x.votes.length} persona positions</td>
                      <td className="px-3 py-2">{x.segments.length ? x.segments.slice(0, 4).join(', ') + (x.segments.length > 4 ? ` +${x.segments.length - 4}` : '') : 'whole panel'}</td>
                      <td className="px-3 py-2">single concept</td>
                      <td className="px-3 py-2">{x.confidence.toLowerCase()}</td>
                      <td className="px-3 py-2 text-ink-muted">Simulated; not evidence of what real people think.</td>
                      <td className="px-3 py-2 text-ink-muted">{report.qualifiedRecommendation}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="next-title" className="panel">
        <div className="panel-head">
          <h2 id="next-title" className="font-sans text-sm font-medium text-ink">Suggested next experiments</h2>
          <span className="text-[11px] text-ink-subtle">rule-based, from this run&apos;s conditions</span>
        </div>
        <ul className="flex flex-col gap-1.5 p-3.5 text-sm text-ink-muted">
          {nextExperiments(report, summary).map((s) => (
            <li key={s} className="flex gap-2"><span aria-hidden className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-brand" />{s}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
