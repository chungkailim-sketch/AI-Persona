import Link from 'next/link';
import type { StepKey } from '@/ui/shell/steps';
import { WorkflowStepper } from '@/ui/shell/WorkflowStepper';
import { computeWorkflowState } from '@/server/workflow';
import { prisma } from '@/lib/prisma';

/**
 * Breadcrumb, sticky project summary and the five-step indicator, rendered above every step.
 * State is computed from the tables of record on each render, never cached client-side.
 */
export async function WorkflowNav({ projectId, projectName, current }: { projectId: string; projectName: string; current: StepKey }) {
  const [state, project] = await Promise.all([
    computeWorkflowState(projectId),
    prisma.project.findUnique({ where: { id: projectId }, select: { status: true, isDemo: true } }),
  ]);
  return (
    <div className="flex flex-col gap-3">
      {/* A breadcrumb is a different navigation from the step indicator, so it gets its own landmark. */}
      <nav aria-label="Breadcrumb" className="no-print">
        <p className="text-sm text-ink-muted">
          <Link href="/projects" className="underline-offset-2 hover:underline">Projects</Link>{' '}
          <span aria-hidden className="text-ink-subtle">/</span> {projectName}
        </p>
      </nav>
      <div className="no-print sticky top-[52px] z-20 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur lg:-mx-6 lg:px-6">
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
      </div>
      <WorkflowStepper projectId={projectId} current={current} state={state} />
    </div>
  );
}
