'use client';

import { useRouter, useSearchParams } from 'next/navigation';

/** Narrows the page to one market's cohorts and personas. The choice lives in the URL, so it can be shared. */
export function MarketFilter({ markets, current }: { markets: string[]; current: string }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm text-ink-muted">
      <span>Market</span>
      <select
        aria-label="Filter cohorts by market"
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set('market', e.target.value);
          else next.delete('market');
          router.push(`?${next.toString()}`, { scroll: false });
        }}
        className="rounded border border-line-strong bg-input px-2 py-1 text-sm text-ink"
      >
        <option value="">All markets</option>
        {markets.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </label>
  );
}
