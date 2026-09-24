import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { assessRunReadiness, listRuns } from '@/server/runs';
import { WorkflowNav } from '../WorkflowNav';
import type { Route } from 'next';
import { ConfirmRunPanel, PlanRunForm, RerunButton } from './SimulateStep';
import { SimulationControlRoom } from './SimulationControlRoom';
import { countEvents, readRecentEvents, readSnapshot } from '@/telemetry/read';

export const metadata = { title: 'Simulation · Persona Intelligence' };
export const dynamic = 'force-dynamic';

export default async function SimulateStepPage(props: PageProps<'/projects/[projectId]/simulate'>) {
  const { projectId } = await props.params;
  const user = await requireUser(`/projects/${projectId}/simulate`);

  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const canRun = can(ctx, 'simulation.run', projectId);
  const canCancel = can(ctx, 'simulation.cancel', projectId);

  const cohortRows = await prisma.cohort.findMany({
    where: { projectId },
    orderBy: { generatedAt: 'desc' },
    include: { personas: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
  });
  const cohorts = cohortRows.map((c) => ({
    id: c.id,
    name: c.name,
    approved: c.personas.filter((p) => p.versions[0]?.approval === 'APPROVED').length,
  }));

  const readiness =
    cohorts.length > 0
      ? await assessRunReadiness(projectId, cohorts[0]!.id)
      : { ready: false, blockers: ['No cohort has been generated. See step 3.'] };

  const runs = await listRuns(user, projectId);
  const search = await props.searchParams;

  // A run that is planned but not yet confirmed is the one waiting for a decision.
  const awaitingConfirmation = runs.find((r) => r.status === 'DRAFT' && !r.config?.confirmedAt);
  const awaitingConfig = awaitingConfirmation
    ? await prisma.runConfig.findUnique({
        where: { runId: awaitingConfirmation.id },
        include: { cohort: true, datasets: true },
      })
    : null;

  // The run on screen: the one asked for, else the newest that has left DRAFT.
  const started = runs.filter((r) => r.status !== 'DRAFT');
  const requested = typeof search.run === 'string' ? search.run : undefined;
  const selected = started.find((r) => r.id === requested) ?? started[0] ?? null;

  const room = selected
    ? await (async () => {
        const scope = { projectId, runId: selected.id };
        const [events, snapshot, total, config] = await Promise.all([
          readRecentEvents(scope, 600),
          readSnapshot(scope),
          countEvents(scope),
          prisma.runConfig.findUnique({
            where: { runId: selected.id },
            include: {
              cohort: {
                include: {
                  personas: {
                    orderBy: { name: 'asc' },
                    include: { versions: { where: { approval: 'APPROVED', enabled: true }, take: 1, select: { id: true } } },
                  },
                },
              },
            },
          }),
        ]);
        const personaKeys = (config?.cohort?.personas ?? []).filter((p) => p.versions.length > 0).map((p) => p.name);
        return { events, snapshot, total, config, personaKeys };
      })()
    : null;
  const canExport = can(ctx, 'report.export', projectId);

  return (
    <div className="flex flex-col gap-5">
      <WorkflowNav projectId={projectId} projectName={project.name} current="SIMULATION" />

      <header>
        <h1 className="text-2xl">Simulation</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          A run asks every approved persona the brief&rsquo;s first hypothesis alone, has at least half
          the panel argue against whatever the majority concluded, lets everyone reconsider, and then
          reports the distribution together with how much of the agreement survived that pressure.
        </p>
        <p className="mt-1 max-w-prose text-sm text-ink-subtle">
          Nothing runs until you confirm a plan. The estimate is shown first.
        </p>
      </header>

      {started.length > 1 && (
        <nav aria-label="Runs" className="flex flex-wrap gap-1">
          {started.map((r) => (
            <Link
              key={r.id}
              href={`/projects/${projectId}/simulate?run=${r.id}` as Route}
              aria-current={r.id === selected?.id ? 'page' : undefined}
              className={
                r.id === selected?.id
                  ? 'rounded border border-brand bg-brand-soft px-2.5 py-1 font-mono text-[11px] text-brand'
                  : 'rounded border border-line bg-surface px-2.5 py-1 font-mono text-[11px] text-ink-muted hover:text-ink'
              }
            >
              {r.createdAt.toISOString().slice(5, 16).replace('T', ' ')} · {r.status.toLowerCase().replace(/_/g, ' ')}
            </Link>
          ))}
        </nav>
      )}

      {selected && room && (
        <SimulationControlRoom
          key={selected.id}
          projectId={projectId}
          info={{
            runId: selected.id,
            name: `Run ${selected.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`,
            mode: selected.mode,
            projectName: project.name,
            cohortName: room.config?.cohort?.name ?? 'Cohort',
            cohortSize: room.personaKeys.length,
            personaKeys: room.personaKeys,
            variants: room.config?.stimulusIds.length ?? 0,
            modelLabel: `${room.config?.modelProvider ?? 'unknown'} · ${room.config?.modelId ?? ''}`,
            seeds: room.config?.seeds ?? [],
            createdAt: selected.createdAt.toISOString(),
            isMock: (room.config?.modelProvider ?? 'mock') === 'mock',
          }}
          initialEvents={room.events}
          initialSnapshot={room.snapshot}
          serverTotal={room.total}
          canCancel={canCancel}
          exportHref={canExport ? `/api/projects/${projectId}/runs/${selected.id}/telemetry` : null}
          resultsHref={`/projects/${projectId}/results?run=${selected.id}`}
          rerun={
            canRun && room.config?.cohortId && !awaitingConfirmation ? (
              <RerunButton projectId={projectId} cohortId={room.config.cohortId} seed={room.config.seeds[0] ?? 42} />
            ) : null
          }
        />
      )}

      {/* ── Confirmation gate ─────────────────────────────────────────────── */}
      {awaitingConfirmation && awaitingConfig && canRun && (
        <section aria-labelledby="confirm" className="border-t border-line pt-6">
          <h2 id="confirm" className="text-lg">Waiting for your confirmation</h2>
          <ConfirmRunPanel
            projectId={projectId}
            plan={{
              runId: awaitingConfirmation.id,
              planHash: awaitingConfig.planHash,
              cohortName: awaitingConfig.cohort?.name ?? 'Cohort',
              personaCount: cohorts.find((c) => c.id === awaitingConfig.cohortId)?.approved ?? 0,
              datasetCount: awaitingConfig.datasets.length,
              provider: awaitingConfig.modelProvider,
              modelId: awaitingConfig.modelId,
              // Recomputed from the persona count so the displayed figure matches the plan.
              estimatedCalls: Math.max(
                1,
                (cohorts.find((c) => c.id === awaitingConfig.cohortId)?.approved ?? 0) * 2,
              ),
              estimatedCostUsd: awaitingConfig.estimatedCostUsd ?? 0,
              budgetCapUsd: awaitingConfig.budgetCapUsd ?? 0,
              isMock: awaitingConfig.modelProvider === 'mock',
            }}
          />
        </section>
      )}

      {/* ── Plan a run ────────────────────────────────────────────────────── */}
      {canRun && !awaitingConfirmation && (
        <section aria-labelledby="plan" className="border-t border-line pt-6">
          <h2 id="plan" className="text-lg">Plan a run</h2>
          <PlanRunForm projectId={projectId} cohorts={cohorts} blockers={readiness.blockers} />
        </section>
      )}

      {!canRun && (
        <p className="panel max-w-prose px-4 py-3 text-sm text-ink-muted">
          You can watch runs in this project but not start one. Running a simulation needs the{' '}
          <span className="font-mono">simulation.run</span> permission.
        </p>
      )}
    </div>
  );
}
