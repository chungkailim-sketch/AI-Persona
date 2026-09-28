'use client';
import { useId, useState } from 'react';
import { cn } from '../cn';

export interface DistributionRow {
  key: string;
  label: string;
  count: number;
  /** Share of the evidence behind this row that was observed or derived, 0..1. */
  evidenceCoverage?: number | null;
  confidence?: string | null;
  selected?: boolean;
  note?: string | null;
}

/**
 * Horizontal bars: one mark per category, labelled directly with count and share, and a table view
 * one click away (UX-05). A single series, so no legend: the heading names it. Bars share one
 * accent — colour carries nothing a reader must decode.
 */
export function SegmentDistributionBar({
  title,
  rows,
  total,
  caption,
  maxRows = 12,
}: {
  title: string;
  rows: DistributionRow[];
  total?: number;
  caption?: string;
  maxRows?: number;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  const sum = total ?? rows.reduce((s, r) => s + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));
  const shown = rows.slice(0, maxRows);
  const hidden = rows.length - shown.length;
  const pct = (n: number) => (sum ? Math.round((n / sum) * 1000) / 10 : 0);

  return (
    <figure className="panel" aria-labelledby={`${id}-t`}>
      <figcaption className="panel-head">
        <span id={`${id}-t`} className="text-sm font-medium text-ink">{title}</span>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          className="rounded border border-line px-2 py-0.5 font-mono text-[10.5px] text-ink-muted hover:border-line-strong hover:text-ink"
        >
          {asTable ? 'Chart view' : 'Table view'}
        </button>
      </figcaption>
      <div className="px-3.5 py-3">
        {rows.length === 0 ? (
          <p className="text-xs text-ink-subtle">No evidence-supported values for this dimension.</p>
        ) : asTable ? (
          <table className="w-full text-left text-xs">
            <thead className="text-ink-subtle">
              <tr>
                <th scope="col" className="py-1 font-normal">Category</th>
                <th scope="col" className="py-1 text-right font-normal">Count</th>
                <th scope="col" className="py-1 text-right font-normal">Share</th>
                <th scope="col" className="py-1 text-right font-normal">Evidence</th>
                <th scope="col" className="py-1 text-right font-normal">Confidence</th>
                <th scope="col" className="py-1 text-right font-normal">Status</th>
              </tr>
            </thead>
            <tbody className="font-mono text-ink-muted">
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <th scope="row" className="py-1 pr-2 font-sans font-normal text-ink">{r.label}</th>
                  <td className="py-1 text-right">{r.count}</td>
                  <td className="py-1 text-right">{pct(r.count)}%</td>
                  <td className="py-1 text-right">{r.evidenceCoverage == null ? '—' : `${Math.round(r.evidenceCoverage * 100)}%`}</td>
                  <td className="py-1 text-right">{r.confidence ?? '—'}</td>
                  <td className="py-1 text-right">{r.selected === undefined ? '—' : r.selected ? 'selected' : 'not selected'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {shown.map((r) => (
              <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-xs" title={r.note ?? undefined}>
                <span className="truncate text-ink">{r.label}</span>
                <span className="relative h-2.5 rounded-full bg-track" aria-hidden>
                  <span
                    className={cn('absolute inset-y-0 left-0 rounded-full motion-progress', r.selected === false ? 'bg-ink-subtle' : 'bg-brand')}
                    style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }}
                  />
                </span>
                <span className="whitespace-nowrap font-mono tabular-nums text-ink-muted">
                  {r.count} · {pct(r.count)}%
                  {r.confidence && <span className="ml-1 text-ink-subtle">{r.confidence.toLowerCase()}</span>}
                </span>
                <span className="sr-only">
                  {`${r.label}: ${r.count} (${pct(r.count)}%)${r.evidenceCoverage != null ? `, evidence coverage ${Math.round(r.evidenceCoverage * 100)}%` : ''}${r.confidence ? `, confidence ${r.confidence}` : ''}`}
                </span>
              </li>
            ))}
            {hidden > 0 && <li className="text-[11px] text-ink-subtle">+{hidden} more — see table view.</li>}
          </ul>
        )}
        {caption && <p className="mt-2 text-[11px] text-ink-subtle">{caption}</p>}
      </div>
    </figure>
  );
}
