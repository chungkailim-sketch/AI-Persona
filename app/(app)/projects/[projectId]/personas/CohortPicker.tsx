'use client';

import { useRouter, useSearchParams } from 'next/navigation';

/** Shows one cohort at a time. The choice lives in the URL, so it can be shared. */
export function CohortPicker({ cohorts, current }: { cohorts: { id: string; label: string }[]; current: string }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
      <span>Cohort</span>
      <select
        aria-label="Choose a cohort to show"
        value={current}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set('cohort', e.target.value);
          router.push(`?${next.toString()}#cohort`, { scroll: false });
        }}
        className="min-w-0 max-w-full rounded border border-line-strong bg-input px-2 py-1 text-sm text-ink"
      >
        {cohorts.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
    </label>
  );
}
