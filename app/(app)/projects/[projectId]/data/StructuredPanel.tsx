import type { StructuredTableView } from '@/ingest/structured';

const KIND_LABEL: Record<string, string> = {
  survey_long: 'Survey long table',
  question_index: 'Question index',
  tabular: 'Table',
};

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The structured output of ingestion: each table typed, described and downloadable, so the data
 * can be loaded into a database, notebook or dashboard without re-doing the clean-up by hand.
 */
export function StructuredPanel({
  projectId,
  datasetVersionId,
  tables,
  canDownload,
}: {
  projectId: string;
  datasetVersionId: string;
  tables: StructuredTableView[];
  canDownload: boolean;
}) {
  const base = `/api/projects/${projectId}/datasets/${datasetVersionId}/structured`;
  return (
    <div className="flex flex-col gap-3">
      {canDownload && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <a href={`${base}/datapackage.json`} download className="rounded border border-line bg-surface px-2 py-1 font-mono text-[11px] text-brand hover:border-line-strong">
            datapackage.json
          </a>
          Frictionless Data Package: every table&rsquo;s schema, types, units and provenance, readable by pandas, R, DuckDB and most BI tools.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {tables.map((t) => (
          <li key={t.id} className="panel" data-structured-table={t.name}>
            <div className="panel-head flex-wrap gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-sans text-sm font-medium text-ink">{t.title}</h3>
                <p className="font-mono text-[10.5px] text-ink-subtle">
                  {t.name}.csv · {t.rowCount.toLocaleString()} rows · {t.columns.length} columns · {bytes(t.byteSize)}
                </p>
              </div>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="rounded-sm border border-line px-1.5 font-mono text-[10px] uppercase text-ink-muted">{KIND_LABEL[t.kind] ?? t.kind}</span>
                {t.isPrimary && (
                  <span className="rounded-sm border border-ok/40 bg-ok-soft px-1.5 font-mono text-[10px] uppercase text-ok" title="Trends, the population sample and the swarm debate read this table.">
                    used for analysis
                  </span>
                )}
                {canDownload && (
                  <a href={`${base}/${t.id}`} download className="rounded border border-brand bg-brand px-2 py-0.5 text-[11px] font-medium text-brand-ink hover:opacity-90">
                    Download CSV
                  </a>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-2 px-3.5 pb-3">
              {(t.notes.length > 0 || t.withheld.length > 0) && (
                <ul className="flex flex-col gap-1">
                  {t.withheld.length > 0 && (
                    <li className="flex gap-2 text-xs text-warn">
                      <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-warn" />
                      {t.withheld.length} column(s) excluded in the field review are withheld from the preview and every download: {t.withheld.join(', ')}.
                    </li>
                  )}
                  {t.notes.slice(0, 6).map((n) => (
                    <li key={n} className="flex gap-2 text-xs text-ink-muted">
                      <span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-ink-subtle" />
                      {n}
                    </li>
                  ))}
                  {t.notes.length > 6 && <li className="text-[11px] text-ink-subtle">…and {t.notes.length - 6} more note(s).</li>}
                </ul>
              )}
              <details>
                <summary className="cursor-pointer text-xs text-brand">Data dictionary</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-ink-subtle">
                      <tr>
                        <th className="py-1 pr-3 font-normal">Column</th>
                        <th className="py-1 pr-3 font-normal">Type</th>
                        <th className="py-1 pr-3 font-normal">Source header</th>
                        <th className="py-1 font-normal">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.columns.map((c) => (
                        <tr key={c.name} className="border-t border-line align-top">
                          <td className="py-1 pr-3 font-mono text-ink">{c.name}</td>
                          <td className="py-1 pr-3 font-mono text-ink-muted">{c.type}{c.unit ? ` (${c.unit})` : ''}</td>
                          <td className="py-1 pr-3 text-ink-muted">{c.sourceName}</td>
                          <td className="py-1 text-ink-muted">{c.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              {t.preview.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-brand">Preview the first {t.preview.length} rows</summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-ink-subtle">
                        <tr>{t.columns.map((c) => <th key={c.name} className="whitespace-nowrap py-1 pr-3 font-mono font-normal">{c.name}</th>)}</tr>
                      </thead>
                      <tbody className="font-mono text-ink">
                        {t.preview.map((r, i) => (
                          <tr key={i} className="border-t border-line">
                            {r.map((v, j) => <td key={j} className="max-w-[18rem] truncate py-1 pr-3" title={v}>{v}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
