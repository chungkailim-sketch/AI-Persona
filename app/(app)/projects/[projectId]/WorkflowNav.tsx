import Link from 'next/link';
import type { Route } from 'next';
import { WORKFLOW_STEPS, type StepKey } from '@/ui/shell/steps';
import { WorkflowStepper } from '@/ui/shell/WorkflowStepper';
import { computeWorkflowState } from '@/server/workflow';
import { prisma } from '@/lib/prisma';
import { cn } from '@/ui/cn';

/**
 * Breadcrumb, sticky project summary and the five-step indicator, rendered above every step.
 * From the sm breakpoint up the summary and the stepper stay pinned together under the top bar, so any
 * step is one click away at any scroll position. Below it the stepper stacks five rows deep, which would
 * cover most of a phone screen, so the pinned summary bar carries a compact row of step links instead.
 * State is computed from the tables of record on each render, never cached client-side.
 */
export async function WorkflowNav({ projectId, projectName, current }: { projectId: string; projectName: string; current: StepKey }) {
  const [state, project] = await Promise.all([
    computeWorkflowState(projectId),
    prisma.project.findUnique({ where: { id: projectId }, select: { status: true, isDemo: true } }),
  ]);
  return (
    // A fragment, not a wrapper: a sticky element only sticks within its parent, so the pinned block has to
    // sit directly in the page's own container to stay put for the whole length of the page.
    <>
      {/* A breadcrumb is a different navigation from the step indicator, so it gets its own landmark. */}
      <nav aria-label="Breadcrumb" className="no-print pb-3">
        <p className="text-sm text-ink-muted">
          <Link href="/projects" className="underline-offset-2 hover:underline">Projects</Link>{' '}
          <span aria-hidden className="text-ink-subtle">/</span> {projectName}
        </p>
      </nav>
      <div className="no-print -mx-4 contents flex-col gap-2 bg-bg/95 px-4 backdrop-blur sm:sticky sm:flex sm:top-[52px] sm:z-20 sm:border-b sm:border-line sm:pb-2 lg:-mx-6 lg:px-6">
        <div className="sticky top-[52px] z-20 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:border-b-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:backdrop-blur-none">
          <span className="font-display text-[15px] font-semibold text-ink">{projectName}</span>
          {project && (
            <span className="rounded-sm border border-line px-1.5 font-mono text-[10px] uppercase text-ink-muted">{project.status.toLowerCase()}</span>
          )}
          {project?.isDemo && (
            <span className="rounded-sm border border-warn/40 bg-warn-soft px-1.5 font-mono text-[10px] uppercase text-warn">Demonstration data</span>
          )}
          <span className="ml-auto font-mono text-[10.5px] text-ink-subtle">
            {Object.values(state).filter((s) => s.status === 'complete').length}/5 steps complete
          </span>
          {/* Phone-width shortcut to every step; the full indicator below carries the status detail. */}
          <nav aria-label="Jump to step" className="w-full sm:hidden">
            <ol className="grid grid-cols-5 gap-1">
              {WORKFLOW_STEPS.map((s) => {
                const isCurrent = s.key === current;
                return (
                  <li key={s.key} className="min-w-0">
                    <Link
                      href={`/projects/${projectId}/${s.href}` as Route}
                      aria-current={isCurrent ? 'step' : undefined}
                      className={cn(
                        'flex flex-col items-center rounded border px-1 py-1 text-[10.5px] leading-tight',
                        isCurrent ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface text-ink-muted',
                        state[s.key].status === 'complete' && !isCurrent && 'border-ok/40 text-ok',
                      )}
                    >
                      <span className="font-mono">{s.index}</span>
                      <span className="w-full truncate text-center">{s.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
        <WorkflowStepper projectId={projectId} current={current} state={state} />
      </div>
    </>
  );
}
