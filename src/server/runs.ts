/**
 * Creating, confirming and cancelling runs.
 *
 * The confirmation step is the point of this module. A run is created in DRAFT with a plan and an
 * estimate, and *nothing happens* until a person looks at the estimate and confirms. That is the
 * difference between a tool that spends money and time on your behalf and one that asks first, and
 * it is enforced in `executeRun` as well as here — a run whose `confirmedAt` is null refuses to
 * execute even if a job for it somehow reaches the worker.
 */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { recordAudit } from '@/lib/audit';
import { enqueue } from '@/queue/queue';
import { env } from '@/lib/env';
import { modelProvider } from '@/model/client';
import { approximateTokens, estimateCostUsd } from '@/model/provider';
import { assessBrief } from '@/server/brief';
import { assessUsability } from '@/ingest/pipeline';
import { computePlanHash, PROMPT_VERSION } from '@/run/orchestrator';

export class RunRefused extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join(' '));
    this.name = 'RunRefused';
  }
}

export interface RunPlan {
  cohortId: string;
  cohortName: string;
  personaCount: number;
  datasetVersionIds: string[];
  briefId: string;
  /** The stimuli the plan hash covers; recorded on the run so results can say what was tested. */
  stimulusIds: string[];
  /** The brief hypothesis the run tests. */
  hypothesisId: string;
  hypothesisLabel: string;
  modelProvider: string;
  modelId: string;
  seeds: number[];
  planHash: string;
  /** Model calls this plan will make, before any failure or retry. */
  estimatedCalls: number;
  estimatedCostUsd: number;
  estimatedMinutes: number;
  isMock: boolean;
  budgetCapUsd: number;
}

/**
 * Everything that would stop this run, gathered in one pass.
 *
 * Reported together rather than one at a time: discovering four prerequisites in four attempts is
 * four times the work and reads as the software being obstructive rather than careful.
 */
export async function assessRunReadiness(
  projectId: string,
  cohortId: string,
): Promise<{ ready: boolean; blockers: string[] }> {
  const blockers: string[] = [];

  const cohort = await prisma.cohort.findFirst({
    where: { id: cohortId, projectId },
    include: {
      personas: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } },
    },
  });
  if (!cohort) return { ready: false, blockers: ['That cohort does not belong to this project.'] };

  const approved = cohort.personas.filter((p) => p.versions[0]?.approval === 'APPROVED').length;
  if (approved === 0) {
    blockers.push('No persona in this cohort has been approved. A run cannot use an unapproved cohort.');
  } else if (approved < 3) {
    blockers.push(
      `Only ${approved} persona(s) are approved. A panel of fewer than three cannot produce ` +
        'agreement that means anything.',
    );
  }

  const brief = await assessBrief(projectId);
  if (!brief.ready) blockers.push(...brief.missing);

  const links = await prisma.projectDataset.findMany({
    where: { projectId },
    include: { dataset: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
  });
  const versionIds = links
    .map((l) => l.dataset.versions[0]?.id)
    .filter((id): id is string => Boolean(id));

  if (versionIds.length === 0) {
    blockers.push('No dataset is attached to this project.');
  } else {
    const verdicts = await Promise.all(versionIds.map((id) => assessUsability(id)));
    const usable = verdicts.filter((v) => v.usable).length;
    if (usable === 0) {
      blockers.push('No attached dataset has been cleared for use. See step 1.');
      for (const v of verdicts) blockers.push(...v.blockers);
    }
  }

  return { ready: blockers.length === 0, blockers };
}

export async function planRun(
  user: SessionUser,
  projectId: string,
  cohortId: string,
  options: { seed?: number; budgetCapUsd?: number; hypothesisId?: string } = {},
): Promise<RunPlan> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'simulation.run', projectId)) {
    throw new AuthorizationError('simulation.run', projectId);
  }

  const readiness = await assessRunReadiness(projectId, cohortId);
  if (!readiness.ready) throw new RunRefused(readiness.blockers);

  const cohort = await prisma.cohort.findFirstOrThrow({
    where: { id: cohortId, projectId },
    include: { personas: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
  });
  const personaCount = cohort.personas.filter((p) => p.versions[0]?.approval === 'APPROVED').length;

  const brief = await prisma.brief.findFirstOrThrow({
    where: { projectId },
    orderBy: { versionNo: 'desc' },
    include: { stimuli: true, hypotheses: { orderBy: { createdAt: 'asc' } } },
  });
  const hypothesis = options.hypothesisId
    ? brief.hypotheses.find((h) => h.id === options.hypothesisId)
    : brief.hypotheses[0];
  if (!hypothesis) throw new RunRefused(['That hypothesis is not part of this project\u2019s brief.']);

  const links = await prisma.projectDataset.findMany({
    where: { projectId },
    include: { dataset: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
  });
  const allVersionIds = links
    .map((l) => l.dataset.versions[0]?.id)
    .filter((id): id is string => Boolean(id));
  const verdicts = await Promise.all(
    allVersionIds.map(async (id) => ({ id, verdict: await assessUsability(id) })),
  );
  const datasetVersionIds = verdicts.filter((v) => v.verdict.usable).map((v) => v.id);

  const provider = modelProvider();
  const seed = options.seed ?? 42;

  // Calls: one independent assessment, one reaction and one revision per persona, and roughly half
  // the panel challenging. (With no stimulus, personas react to the hypothesis itself.)
  const estimatedCalls = personaCount * 3 + Math.ceil(personaCount / 2);

  // Rough, and labelled as rough wherever it is shown. The evidence block dominates the input.
  const contextTokens = 2500;
  const outputTokens = 400;
  const estimatedCostUsd =
    provider.name === 'mock'
      ? 0
      : estimatedCalls * estimateCostUsd(provider.modelId, contextTokens, outputTokens);

  const planHash = computePlanHash({
    cohortId,
    datasetVersionIds,
    briefId: brief.id,
    modelId: provider.modelId,
    seeds: [seed],
    promptVersion: PROMPT_VERSION,
    stimulusIds: brief.stimuli.map((s) => s.id),
    hypothesisId: hypothesis.id,
  });

  return {
    cohortId,
    cohortName: cohort.name,
    personaCount,
    datasetVersionIds,
    briefId: brief.id,
    stimulusIds: brief.stimuli.map((s) => s.id),
    hypothesisId: hypothesis.id,
    hypothesisLabel: `${hypothesis.label}: ${hypothesis.statement}`,
    modelProvider: provider.name,
    modelId: provider.modelId,
    seeds: [seed],
    planHash,
    estimatedCalls,
    estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
    // Sequential calls, roughly four seconds each against a live provider.
    estimatedMinutes: provider.name === 'mock' ? 0 : Math.ceil((estimatedCalls * 4) / 60),
    isMock: provider.name === 'mock',
    budgetCapUsd: options.budgetCapUsd ?? env().AI_RUN_BUDGET_USD,
  };
}

export async function createRun(
  user: SessionUser,
  projectId: string,
  plan: RunPlan,
  meta: { ip?: string | null } = {},
): Promise<{ runId: string }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'simulation.run', projectId)) {
    throw new AuthorizationError('simulation.run', projectId);
  }

  const run = await prisma.$transaction(async (tx) => {
    const r = await tx.run.create({
      data: {
        projectId,
        briefId: plan.briefId,
        status: 'DRAFT',
        mode: 'SINGLE_CONCEPT',
        isMock: plan.isMock,
        createdById: user.userId,
      },
    });
    const config = await tx.runConfig.create({
      data: {
        runId: r.id,
        cohortId: plan.cohortId,
        planHash: plan.planHash,
        // Found in an end-to-end run: the stimulus was in the plan hash and the orchestrator
        // reacted to it, but it was never recorded here, so the results said "no stimulus".
        stimulusIds: plan.stimulusIds,
        hypothesisId: plan.hypothesisId,
        seeds: plan.seeds,
        modelId: plan.modelId,
        modelProvider: plan.modelProvider,
        promptVersions: { all: PROMPT_VERSION },
        budgetCapUsd: plan.budgetCapUsd,
        estimatedCostUsd: plan.estimatedCostUsd,
        // Deliberately null. Nothing runs until someone sets it.
        confirmedAt: null,
      },
    });
    await tx.runConfigDataset.createMany({
      data: plan.datasetVersionIds.map((id) => ({
        runConfigId: config.id,
        datasetVersionId: id,
      })),
    });
    // A run locks its brief: editing it afterwards would change what the run reports having tested.
    await tx.brief.update({ where: { id: plan.briefId }, data: { status: 'LOCKED' } });
    return r;
  });

  await recordAudit({
    action: 'run.created',
    targetType: 'run',
    targetId: run.id,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: {
      planHash: plan.planHash,
      personaCount: plan.personaCount,
      estimatedCalls: plan.estimatedCalls,
      estimatedCostUsd: plan.estimatedCostUsd,
      provider: plan.modelProvider,
    },
    ip: meta.ip ?? null,
  });

  return { runId: run.id };
}

/**
 * Confirm and queue.
 *
 * The confirmation is recorded against a name and a time, and the plan hash is checked: if anything
 * about the plan changed between the estimate being shown and the confirmation arriving, the
 * confirmation is refused rather than applied to a different run than the one that was approved.
 */
export async function confirmRun(
  user: SessionUser,
  projectId: string,
  runId: string,
  expectedPlanHash: string,
  meta: { ip?: string | null } = {},
): Promise<{ jobId: string }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'simulation.run', projectId)) {
    throw new AuthorizationError('simulation.run', projectId);
  }

  const run = await prisma.run.findFirst({
    where: { id: runId, projectId },
    include: { config: true },
  });
  if (!run?.config) throw new AuthorizationError('simulation.run', projectId);

  if (run.config.confirmedAt) {
    throw new RunRefused(['This run has already been confirmed.']);
  }
  if (run.config.planHash !== expectedPlanHash) {
    throw new RunRefused([
      'The plan changed after the estimate was shown. Review the new plan and confirm again — ' +
        'this confirmation would have started a different run from the one you approved.',
    ]);
  }

  await prisma.$transaction([
    prisma.runConfig.update({
      where: { id: run.config.id },
      data: { confirmedAt: new Date(), confirmedById: user.userId },
    }),
    prisma.run.update({ where: { id: runId }, data: { status: 'QUEUED' } }),
  ]);

  const { id: jobId } = await enqueue({
    kind: 'simulate',
    input: { runId },
    runId,
    idempotencyKey: `simulate:${runId}`,
  });

  await recordAudit({
    action: 'run.confirmed',
    targetType: 'run',
    targetId: runId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: { planHash: run.config.planHash, estimatedCostUsd: run.config.estimatedCostUsd },
    reason: `Run confirmed by ${user.email}`,
    ip: meta.ip ?? null,
  });

  return { jobId };
}

export async function requestCancel(
  user: SessionUser,
  projectId: string,
  runId: string,
  meta: { ip?: string | null } = {},
): Promise<void> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'simulation.cancel', projectId)) {
    throw new AuthorizationError('simulation.cancel', projectId);
  }

  // Cooperative: the orchestrator checks this flag between personas and between stages. Killing the
  // worker mid-call would leave the run in a state nobody can explain.
  await prisma.run.updateMany({
    where: { id: runId, projectId, status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] } },
    data: { cancelRequested: true },
  });

  await recordAudit({
    action: 'run.cancelled',
    targetType: 'run',
    targetId: runId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    reason: 'Cancellation requested',
    ip: meta.ip ?? null,
  });
}

export async function listRuns(user: SessionUser, projectId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);

  return prisma.run.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: {
      config: { select: { planHash: true, estimatedCostUsd: true, confirmedAt: true, hypothesisId: true } },
      steps: { orderBy: { sequence: 'asc' } },
      _count: { select: { findings: true, modelCalls: true } },
    },
  });
}

export async function getRun(user: SessionUser, projectId: string, runId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);

  const run = await prisma.run.findFirst({
    where: { id: runId, projectId },
    include: {
      config: { include: { cohort: true, datasets: true } },
      steps: { orderBy: { sequence: 'asc' } },
      findings: { include: { votes: { orderBy: { round: 'asc' } } } },
      metrics: true,
      synthesis: { include: { dissents: true, recommendations: { orderBy: { rank: 'asc' } } } },
      brief: { include: { hypotheses: true } },
    },
  });
  if (!run) throw new AuthorizationError('project.view', projectId);

  const spend = await prisma.modelCall.aggregate({
    where: { runId },
    _sum: { costUsd: true, inputTokens: true, outputTokens: true },
    _count: true,
  });

  return { run, spend };
}
