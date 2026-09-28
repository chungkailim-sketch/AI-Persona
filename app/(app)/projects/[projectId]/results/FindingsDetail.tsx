import type { FindingsDetail } from '@/report/summary';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-line bg-surface px-3 py-2">
      <p className="text-[11px] text-ink-subtle">{label}</p>
      <p className="mt-0.5 font-mono text-lg text-ink">{value}</p>
      {sub && <p className="text-[11px] text-ink-subtle">{sub}</p>}
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <span className="inline-block h-1.5 w-24 overflow-hidden rounded bg-line align-middle" aria-hidden>
      <span className="block h-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

/**
 * The high-level view of a run's finding for one hypothesis: how much of the panel supported it
 * (with a 95% interval, because a panel of eight is a small sample), where support came from by
 * market and segment, how the segments reacted, and what the personas actually said.
 */
export function FindingsDetailPanel({ detail }: { detail: FindingsDetail }) {
  const d = detail;
  const r = d.reactions;
  const reacted = r.positive + r.mixed + r.negative;
  return (
    <div className="mt-4 flex flex-col gap-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Support after challenge"
          value={d.support.pct === null ? '—' : `${d.support.pct}%`}
          sub={d.support.ci ? `${d.support.confirm} of ${d.panel} · 95% interval ${d.support.ci.low}–${d.support.ci.high}%` : undefined}
        />
        <Stat label="Support before any exposure" value={d.independentSupportPct === null ? '—' : `${d.independentSupportPct}%`} sub="Independent round — the only one free of herding" />
        <Stat label="Stance split" value={`${d.support.confirm} · ${d.support.dispute} · ${d.support.abstain}`} sub="confirm · dispute · abstain" />
        <Stat label="Mean stated confidence" value={d.meanConfidence.independent === null ? '—' : d.meanConfidence.independent.toFixed(2)} sub="0–1, self-reported in the independent round" />
      </div>

      {d.byMarket.length > 1 && (
        <div>
          <h3 className="text-sm font-medium text-ink">Support by market</h3>
          <table className="mt-1 w-full max-w-2xl text-left text-xs">
            <thead className="text-ink-subtle"><tr><th className="py-1 pr-3 font-normal">Market</th><th className="py-1 pr-3 font-normal">Personas</th><th className="py-1 pr-3 font-normal">Confirm · dispute · abstain</th><th className="py-1 font-normal">Support</th></tr></thead>
            <tbody>
              {d.byMarket.map((m) => (
                <tr key={m.market} className="border-t border-line">
                  <td className="py-1 pr-3 text-ink">{m.market}</td>
                  <td className="py-1 pr-3 font-mono">{m.n}</td>
                  <td className="py-1 pr-3 font-mono">{m.confirm} · {m.dispute} · {m.abstain}</td>
                  <td className="py-1 font-mono"><Bar pct={m.pct} /> {m.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.bySegment.length > 1 && (
        <div>
          <h3 className="text-sm font-medium text-ink">Support by segment</h3>
          <ul className="mt-1 grid max-w-2xl gap-1 text-xs sm:grid-cols-2">
            {d.bySegment.map((s) => (
              <li key={s.segment} className="flex items-center justify-between gap-2 border-b border-line py-1">
                <span className="text-ink">{s.segment} <span className="text-ink-subtle">({s.n})</span></span>
                <span className="font-mono"><Bar pct={s.pct} /> {s.pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reacted > 0 && (
        <div>
          <h3 className="text-sm font-medium text-ink">Consumer reaction</h3>
          <p className="text-xs text-ink-muted">
            {r.positive} positive · {r.mixed} mixed · {r.negative} negative
            {r.meanIntensity !== null && ` · mean intensity ${r.meanIntensity.toFixed(2)}`}
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {r.drivers.length > 0 && (
              <div>
                <p className="text-xs font-medium text-ink">Most-cited drivers</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-muted">{r.drivers.map((x) => <li key={x.text}>{x.text} <span className="font-mono text-ink-subtle">×{x.count}</span></li>)}</ul>
              </div>
            )}
            {r.barriers.length > 0 && (
              <div>
                <p className="text-xs font-medium text-ink">Most-cited barriers</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-muted">{r.barriers.map((x) => <li key={x.text}>{x.text} <span className="font-mono text-ink-subtle">×{x.count}</span></li>)}</ul>
              </div>
            )}
          </div>
        </div>
      )}

      {d.quotes.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-ink">In the personas&rsquo; words</h3>
          <ul className="mt-1 grid gap-2 md:grid-cols-2">
            {d.quotes.map((q) => (
              <li key={`${q.persona}-${q.stance}`} className="rounded border border-line bg-surface px-3 py-2">
                <p className="text-[11px] text-ink-subtle">
                  {q.segment} · <span className="font-mono">{q.stance}</span>{q.confidence !== null && ` · confidence ${q.confidence.toFixed(2)}`}
                </p>
                <p className="mt-1 text-xs text-ink">&ldquo;{q.text}&rdquo;</p>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-ink-subtle">Simulated; not evidence of what real people think.</p>
        </div>
      )}

      {d.evidenceCited.length > 0 && (
        <p className="text-xs text-ink-muted">
          <span className="font-medium text-ink">Evidence the panel cited most:</span>{' '}
          {d.evidenceCited.map((e) => `${e.field} (${e.count})`).join(', ')}
        </p>
      )}
    </div>
  );
}
