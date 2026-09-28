'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import type { ActivitySummary } from '@/server/activity';
import { LiveIndicator } from '../components/LiveIndicator';

/**
 * Runs in progress across your projects. Checks the server every 15 seconds while the tab is
 * visible; the figure is what the server reported, with the time it reported it.
 */
export function GlobalRunIndicator({ initial }: { initial: ActivitySummary }) {
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/me/activity', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        if (!stopped) {
          setData((await res.json()) as ActivitySummary);
          setStale(false);
        }
      } catch {
        if (!stopped) setStale(true);
      }
    };
    const t = setInterval(tick, 15_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  const runs = data.activeRuns.length;
  const busy = runs > 0 || data.ingesting > 0;
  const label = busy
    ? `${runs} run${runs === 1 ? '' : 's'}${data.ingesting ? ` · ${data.ingesting} ingesting` : ''}`
    : 'Nothing running';
  const first = data.activeRuns[0];
  const href = first ? `/projects/${first.projectId}/simulate?run=${first.id}` : '/runs';
  return (
    <Link
      href={href as Route}
      className="hidden items-center rounded border border-line px-2 py-1 hover:border-line-strong lg:inline-flex"
      title={`${label}. Checked ${data.checkedAt.slice(11, 19)}Z${stale ? ' — could not refresh' : ''}.`}
      data-global-runs={runs}
    >
      <LiveIndicator state={stale ? 'delayed' : busy ? 'live' : 'idle'} label={label} />
    </Link>
  );
}
