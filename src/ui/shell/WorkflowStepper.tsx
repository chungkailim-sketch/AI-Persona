import Link from 'next/link';
import type { Route } from 'next';
import { WORKFLOW_STEPS, type StepKey } from './steps';
import type { WorkflowState, WorkflowStatus } from '@/server/workflow';
import { Icon } from '../components/Icon';
import { cn } from '../cn';
import { fmtDateTime, TZ_LABEL } from '@/lib/time';

const META: Record<WorkflowStatus, { label: string; icon: string; cls: string; ring: string }> = {
  complete: { label: 'Complete', icon: 'check', cls: 'border-ok/40 bg-ok-soft text-ok', ring: 'border-ok/40' },
  running: { label: 'In progress', icon: 'live', cls: 'border-info/40 bg-info-soft text-info', ring: 'border-info/50' },
  warning: { label: 'Needs attention', icon: 'alert', cls: 'border-warn/40 bg-warn-soft text-warn', ring: 'border-warn/50' },
  error: { label: 'Error', icon: 'cross', cls: 'border-danger/40 bg-danger-soft text-danger', ring: 'border-danger/50' },
  blocked: { label: 'Blocked', icon: 'slash', cls: 'border-line bg-pending-soft text-pending', ring: 'border-line border-dashed' },
  available: { label: 'Available', icon: 'dot', cls: 'border-line bg-surface text-ink-muted', ring: 'border-line' },
};

function savedLabel(iso: string | null): string {
  if (!iso) return 'not saved yet';
  return `saved ${fmtDateTime(iso)} ${TZ_LABEL}`;
}

/**
 * The five-step indicator (UX-02, FR-83). Every step is a link — the workflow has an order but is
 * not a trap — and each states its completion, warnings, errors, blocked reason, unresolved count
 * and last save in words, with the icon and colour only reinforcing them.
 */
export function WorkflowStepper({ projectId, current, state }: { projectId: string; current: StepKey; state: WorkflowState }) {
  return (
    <nav aria-label="Project workflow" className="no-print">
      <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-5">
        {WORKFLOW_STEPS.map((s) => {
          const st = state[s.key];
          const meta = META[st.status];
          const isCurrent = s.key === current;
          return (
            <li key={s.key} className="min-w-0" data-step={s.key} data-step-status={st.status}>
              <Link
                href={`/projects/${projectId}/${s.href}` as Route}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'motion-color flex h-full flex-col gap-1 rounded border bg-surface px-2.5 py-2 hover:border-line-strong',
                  meta.ring,
                  isCurrent && 'border-brand ring-1 ring-brand',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px]', isCurrent ? 'border-brand bg-brand text-brand-ink' : meta.cls)} aria-hidden>
                    {st.status === 'available' || isCurrent ? s.index : <Icon name={meta.icon} size={11} className={st.status === 'running' ? 'motion-live' : undefined} />}
                  </span>
                  <span className={cn('truncate text-[13px]', isCurrent ? 'font-semibold text-ink' : 'text-ink-muted')}>{s.label}</span>
                  {st.unresolved > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-warn-soft px-1.5 font-mono text-[10px] text-warn" aria-hidden>
                      {st.unresolved}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-ink-subtle">
                  <span className="shrink-0 whitespace-nowrap">{meta.label}</span>
                  <span aria-hidden>·</span>
                  <span className="normal-case tracking-normal">{savedLabel(st.lastSavedAt)}</span>
                </span>
                {st.reason && st.status !== 'complete' && <span className="line-clamp-2 text-[11px] leading-snug text-ink-subtle">{st.reason}</span>}
                <span className="sr-only">
                  {`Step ${s.index} of 5: ${s.label}. ${isCurrent ? 'Current step. ' : ''}${meta.label}.${st.reason ? ` ${st.reason}` : ''}${st.unresolved > 0 ? ` ${st.unresolved} unresolved item(s).` : ''} ${savedLabel(st.lastSavedAt)}.`}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
