import { EmptyState } from './States';

export interface VariantRow {
  segment: string;
  a: string | null;
  b: string | null;
  difference: string | null;
  cohort: number | null;
  coverage: string | null;
  status: string;
  explanation: string;
}

/**
 * Variant A versus B by segment. This build's orchestrator tests one stimulus per run, so there is
 * no second variant to compare; the component says so rather than inventing a column. No
 * significance is claimed anywhere: no statistical test is run.
 */
export function VariantComparisonTable({ rows, variantLabels, unavailableReason }: { rows: VariantRow[]; variantLabels: [string, string]; unavailableReason?: string | null }) {
  if (unavailableReason) {
    return (
      <EmptyState title="Variant comparison unavailable" icon="slash">
        {unavailableReason}
      </EmptyState>
    );
  }
  return (
    <div className="panel overflow-x-auto" tabIndex={0} role="region" aria-label="Variant comparison table">
      <table className="w-full min-w-[44rem] text-left text-[12.5px]">
        <caption className="sr-only">Segment comparison of {variantLabels[0]} and {variantLabels[1]}. No statistical significance is claimed.</caption>
        <thead className="border-b border-line text-ink-subtle">
          <tr>
            {['Segment', variantLabels[0], variantLabels[1], 'Difference', 'Cohort', 'Coverage', 'Status', 'Key explanation'].map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.segment} className="border-b border-line/70 align-top">
              <th scope="row" className="px-3 py-2 font-normal text-ink">{r.segment}</th>
              <td className="px-3 py-2 font-mono">{r.a ?? '—'}</td>
              <td className="px-3 py-2 font-mono">{r.b ?? '—'}</td>
              <td className="px-3 py-2 font-mono">{r.difference ?? '—'}</td>
              <td className="px-3 py-2 font-mono">{r.cohort ?? '—'}</td>
              <td className="px-3 py-2">{r.coverage ?? '—'}</td>
              <td className="px-3 py-2">{r.status}</td>
              <td className="px-3 py-2 text-ink-muted">{r.explanation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
