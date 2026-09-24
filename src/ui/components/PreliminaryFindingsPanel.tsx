import Link from 'next/link';
import type { Route } from 'next';
import type { PreliminaryTally } from '@/telemetry/reduce';
import { Icon } from './Icon';

/**
 * The independent-round tally as it accumulates. The method permits showing it — the independent
 * round is the one whose answers do not change later — but it is labelled on every line as
 * preliminary, and it gives way to the report the moment the run completes.
 */
export function PreliminaryFindingsPanel({ tally, resultsHref, completed }: { tally: PreliminaryTally | null; resultsHref: string; completed: boolean }) {
  if (completed || tally?.superseded) {
    return (
      <section className="panel border-ok/50" aria-labelledby="prelim-title" data-findings="final">
        <div className="panel-head">
          <h3 id="prelim-title" className="font-sans text-sm font-medium text-ink">Findings</h3>
          <span className="inline-flex items-center gap-1 rounded-sm border border-ok/40 bg-ok-soft px-1.5 py-px font-mono text-[10px] uppercase text-ok">
            <Icon name="check" size={11} /> Final
          </span>
        </div>
        <p className="p-3 text-sm text-ink-muted">
          The run has completed. Preliminary figures are withdrawn in favour of the report, which carries the
          classification, the dissent and the limitations.{' '}
          <Link href={resultsHref as Route} className="text-link underline underline-offset-2">Read the results</Link>
        </p>
      </section>
    );
  }
  return (
    <section className="panel border-info/50" aria-labelledby="prelim-title" data-findings="preliminary">
      <div className="panel-head">
        <h3 id="prelim-title" className="font-sans text-sm font-medium text-ink">Emerging findings</h3>
        <span className="inline-flex items-center gap-1 rounded-sm border border-info/40 bg-info-soft px-1.5 py-px font-mono text-[10px] uppercase text-info">
          <Icon name="clock" size={11} /> Preliminary
        </span>
      </div>
      <div className="p-3">
        {!tally ? (
          <p className="text-xs text-ink-subtle">Nothing yet. Figures appear once the independent round has answers.</p>
        ) : (
          <>
            <p className="text-[12px] text-ink-muted">
              Independent-round stances from <strong className="font-medium text-ink">{tally.processed}</strong>
              {tally.total ? ` of ${tally.total}` : ''} persona(s). Incomplete and subject to change: the challenge and revision rounds,
              the anti-herding check and the classification have not run on these figures.
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              {(['confirm', 'dispute', 'abstain'] as const).map((k) => (
                <div key={k} className="rounded border border-line py-1.5">
                  <dt className="eyebrow">{k}</dt>
                  <dd className="font-mono text-lg tabular-nums text-ink">{tally[k]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-ink-subtle">Based on the currently processed portion of the cohort. Not a result.</p>
          </>
        )}
      </div>
    </section>
  );
}
