import type { ReactNode } from 'react';
import { cn } from '../cn';
import { TONE_TEXT } from './tone';
import type { Tone } from '@/telemetry/status';
import { fmtTime, TZ_LABEL } from '@/lib/time';

export interface MetricCardProps {
  label: string;
  /** `null` renders "Unavailable" — a metric the backend cannot calculate is never shown as 0. */
  value: string | number | null;
  unit?: string;
  /** What the number means and where it comes from. Shown on hover and read by screen readers. */
  definition: string;
  tone?: Tone;
  sub?: ReactNode;
  updatedAt?: string | null;
  live?: boolean;
  compact?: boolean;
}

export function MetricCard({ label, value, unit, definition, tone, sub, updatedAt, live, compact }: MetricCardProps) {
  const unavailable = value === null || value === undefined;
  return (
    <div className={cn('panel flex min-w-0 flex-col', compact ? 'p-2.5' : 'p-3')} title={definition}>
      <dt className="flex items-center justify-between gap-2">
        <span className="eyebrow truncate">{label}</span>
        {live && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok motion-live" />}
      </dt>
      <dd className="mt-1 min-w-0">
        {unavailable ? (
          <span className="font-mono text-sm text-ink-subtle">Unavailable</span>
        ) : (
          <span className={cn('font-mono tabular-nums', compact ? 'text-lg' : 'text-2xl', tone ? TONE_TEXT[tone] : 'text-ink')}>
            {value}
            {unit && <span className="ml-0.5 text-xs text-ink-subtle">{unit}</span>}
          </span>
        )}
        <span className="sr-only">. {definition}</span>
        {sub && <div className="mt-0.5 text-[11px] leading-snug text-ink-subtle">{sub}</div>}
        {updatedAt && !compact && (
          <div className="mt-0.5 font-mono text-[10px] text-ink-subtle">updated {fmtTime(updatedAt)} {TZ_LABEL}</div>
        )}
      </dd>
    </div>
  );
}

export function MetricGrid({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <dl aria-label={label} className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6', className)}>
      {children}
    </dl>
  );
}
