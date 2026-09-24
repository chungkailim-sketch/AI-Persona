'use client';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from '../cn';

export function EmptyState({ title, children, action, icon = 'dot', className }: { title: string; children?: ReactNode; action?: ReactNode; icon?: string; className?: string }) {
  return (
    <div className={cn('panel flex flex-col items-start gap-2 px-4 py-6', className)}>
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <Icon name={icon} className="text-ink-subtle" />
        {title}
      </span>
      {children && <div className="max-w-prose text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/**
 * What happened, why, and what to do next (UX-09). A correlation id is shown when there is one so
 * support can find the server-side record; the error itself never is.
 */
export function ErrorState({
  title,
  cause,
  remedy,
  correlationId,
  onRetry,
  retryLabel = 'Try again',
  className,
}: {
  title: string;
  cause: string;
  remedy: string;
  correlationId?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('rounded border border-danger/60 bg-danger-soft px-4 py-3', className)}>
      <p className="flex items-center gap-2 text-sm font-medium text-danger">
        <Icon name="cross" />
        {title}
      </p>
      <p className="mt-1 text-sm text-ink">{cause}</p>
      <p className="mt-1 text-sm text-ink-muted">{remedy}</p>
      {correlationId && <p className="mt-1 font-mono text-[11px] text-ink-subtle">correlation {correlationId}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 inline-flex items-center gap-1.5 rounded border border-line-strong bg-surface px-3 py-1.5 text-xs text-ink hover:border-danger">
          <Icon name="retry" size={14} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}
