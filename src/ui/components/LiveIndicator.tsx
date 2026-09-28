import { cn } from '../cn';

export type LiveState = 'live' | 'idle' | 'complete' | 'failed' | 'offline' | 'delayed';

const TEXT: Record<LiveState, string> = {
  live: 'Live',
  idle: 'Idle',
  complete: 'Complete',
  failed: 'Stopped',
  offline: 'Offline',
  delayed: 'Delayed',
};

const DOT: Record<LiveState, string> = {
  live: 'bg-ok',
  idle: 'bg-pending',
  complete: 'bg-ok',
  failed: 'bg-danger',
  offline: 'bg-danger',
  delayed: 'bg-warn',
};

/**
 * Whether what is on screen is live. The pulse runs only in the `live` state and stops the moment
 * the process stops; the word says the same thing for anyone who cannot see or does not get motion.
 */
export function LiveIndicator({ state, label, className }: { state: LiveState; label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-ink-muted', className)}>
      <span aria-hidden className="relative inline-flex h-2 w-2">
        <span className={cn('absolute inset-0 rounded-full', DOT[state], state === 'live' && 'motion-live')} />
      </span>
      <span>{label ?? TEXT[state]}</span>
    </span>
  );
}
