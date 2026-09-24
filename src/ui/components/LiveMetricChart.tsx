'use client';
import { memo, useMemo, useState } from 'react';
import type { TelemetryEvent } from '@/telemetry/contract';

/**
 * Completed model calls per time bucket, stacked by verdict — computed from recorded events only.
 * A single measure on one axis; the table view carries the same numbers.
 */
export const LiveMetricChart = memo(function LiveMetricChart({ events, bucketSeconds = 10, maxBuckets = 30 }: { events: TelemetryEvent[]; bucketSeconds?: number; maxBuckets?: number }) {
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const buckets = useMemo(() => {
    const calls = events.filter((e) => e.eventType === 'run.call.completed');
    if (calls.length === 0) return [];
    const map = new Map<number, { t: number; pass: number; flag: number; fail: number }>();
    for (const e of calls) {
      const t = Math.floor(Date.parse(e.timestamp) / 1000 / bucketSeconds) * bucketSeconds;
      const b = map.get(t) ?? { t, pass: 0, flag: 0, fail: 0 };
      const v = e.safeMetadata?.verdict;
      if (v === 'pass') b.pass += 1;
      else if (v === 'flag') b.flag += 1;
      else b.fail += 1;
      map.set(t, b);
    }
    const sorted = [...map.values()].sort((a, b) => a.t - b.t);
    // Fill empty buckets between first and last so gaps read as gaps.
    const out: typeof sorted = [];
    for (let t = sorted[0]!.t; t <= sorted[sorted.length - 1]!.t; t += bucketSeconds) out.push(map.get(t) ?? { t, pass: 0, flag: 0, fail: 0 });
    return out.slice(-maxBuckets);
  }, [events, bucketSeconds, maxBuckets]);

  const max = Math.max(1, ...buckets.map((b) => b.pass + b.flag + b.fail));
  const W = 100 / Math.max(buckets.length, 1);
  const fmt = (t: number) => new Date(t * 1000).toISOString().slice(11, 19);

  return (
    <figure className="panel" aria-labelledby="throughput-title">
      <figcaption className="panel-head">
        <span id="throughput-title" className="text-sm font-medium text-ink">Throughput · calls per {bucketSeconds}s</span>
        <button type="button" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} className="rounded border border-line px-2 py-0.5 font-mono text-[10.5px] text-ink-muted hover:text-ink">
          {asTable ? 'Chart view' : 'Table view'}
        </button>
      </figcaption>
      <div className="p-3">
        {buckets.length === 0 ? (
          <p className="text-xs text-ink-subtle">No completed calls yet.</p>
        ) : asTable ? (
          <table className="w-full text-left font-mono text-[11px] text-ink-muted">
            <thead className="text-ink-subtle">
              <tr><th scope="col" className="font-normal">Bucket (UTC)</th><th scope="col" className="text-right font-normal">Pass</th><th scope="col" className="text-right font-normal">Flag</th><th scope="col" className="text-right font-normal">Fail</th></tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.t} className="border-t border-line"><th scope="row" className="font-normal">{fmt(b.t)}</th><td className="text-right">{b.pass}</td><td className="text-right">{b.flag}</td><td className="text-right">{b.fail}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="relative">
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label={`Completed calls per ${bucketSeconds} seconds over the last ${buckets.length} intervals; peak ${max}.`}>
              <line x1="0" y1="39.5" x2="100" y2="39.5" stroke="var(--color-line)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
              {buckets.map((b, i) => {
                const x = i * W + W * 0.15;
                const w = W * 0.7;
                let y = 40;
                const segs = [
                  { n: b.pass, c: 'var(--color-ok)' },
                  { n: b.flag, c: 'var(--color-warn)' },
                  { n: b.fail, c: 'var(--color-danger)' },
                ];
                return (
                  <g key={b.t} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                    <rect x={i * W} y={0} width={W} height={40} fill="transparent" />
                    {segs.map((s, j) => {
                      if (s.n === 0) return null;
                      const h = (s.n / max) * 38;
                      y -= h;
                      return <rect key={j} x={x} y={y + 0.4} width={w} height={Math.max(h - 0.4, 0.4)} fill={s.c} rx={0.6} />;
                    })}
                  </g>
                );
              })}
            </svg>
            {hover !== null && buckets[hover] && (
              <div className="pointer-events-none absolute -top-1 right-0 rounded border border-line bg-surface-raised px-2 py-1 font-mono text-[10.5px] text-ink shadow-pop">
                {fmt(buckets[hover]!.t)} · pass {buckets[hover]!.pass} · flag {buckets[hover]!.flag} · fail {buckets[hover]!.fail}
              </div>
            )}
            <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-subtle">
              <span>{fmt(buckets[0]!.t)}</span>
              <span className="flex gap-3">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-ok" aria-hidden />pass</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-warn" aria-hidden />flag</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-danger" aria-hidden />fail</span>
              </span>
              <span>{fmt(buckets[buckets.length - 1]!.t)}</span>
            </div>
          </div>
        )}
      </div>
    </figure>
  );
});
