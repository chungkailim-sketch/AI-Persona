/**
 * Requesting and reading swarm debates (server only).
 *
 * Starting a debate spends model budget exactly as a run does, so it needs the same permission
 * (`simulation.run`), runs on the worker rather than in a request, and is audited.
 */
import { randomInt } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { enqueue } from '@/queue/queue';
import { recordAudit } from '@/lib/audit';

export class DebateRequestRefused extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'DebateRequestRefused';
  }
}

export interface DebateRequest {
  cohortId: string;
  topic: string;
  hypothesis?: string | null;
  focusSegments?: string[];
  rounds?: number;
  contextRunId?: string | null;
}

export async function requestDebate(user: SessionUser, projectId: string, input: DebateRequest): Promise<{ debateId: string }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'simulation.run', projectId)) throw new AuthorizationError('simulation.run', projectId);

  const problems: string[] = [];
  const topic = input.topic.trim();
  const hypothesis = input.hypothesis?.trim() || null;
  if (topic.length < 10) problems.push('State the motion or topic to debate in at least a sentence.');
  if (topic.length > 1000) problems.push('Keep the motion under 1,000 characters.');
  if (hypothesis && hypothesis.length > 1000) problems.push('Keep the hypothesis under 1,000 characters.');
  const rounds = Math.floor(input.rounds ?? 2);
  if (!(rounds >= 1 && rounds <= 3)) problems.push('Choose between one and three rebuttal rounds.');
  const focusSegments = (input.focusSegments ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4);

  const cohort = await prisma.cohort.findFirst({
    where: { id: input.cohortId, projectId },
    include: { personas: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
  });
  if (!cohort) problems.push('Choose a cohort from this project.');
  else {
    const approved = cohort.personas.filter((p) => p.versions[0]?.approval === 'APPROVED').length;
    if (approved < 2) problems.push('The cohort needs at least two approved personas. Approve it first.');
  }
  if (input.contextRunId) {
    const run = await prisma.run.findFirst({ where: { id: input.contextRunId, projectId }, select: { id: true } });
    if (!run) problems.push('That simulation run is not part of this project.');
  }
  if (problems.length > 0) throw new DebateRequestRefused(problems);

  const debate = await prisma.debate.create({
    data: {
      projectId,
      cohortId: input.cohortId,
      contextRunId: input.contextRunId ?? null,
      topic,
      hypothesis,
      focusSegments,
      rounds,
      // Recorded so the debate can be re-run with the same seed and compared.
      seed: randomInt(1, 2_000_000_000),
      createdById: user.userId,
    },
  });
  await enqueue({ kind: 'debate', input: { debateId: debate.id }, idempotencyKey: `debate:${debate.id}`, maxAttempts: 1 });
  await recordAudit({
    action: 'debate.requested',
    targetType: 'debate',
    targetId: debate.id,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    reason: `Swarm debate requested on cohort ${cohort!.name} (${rounds} round(s))`,
  });
  return { debateId: debate.id };
}

export async function listDebates(user: SessionUser, projectId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);
  return prisma.debate.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, topic: true, status: true, phase: true, createdAt: true, isMock: true, cohort: { select: { name: true } } },
  });
}

export async function getDebate(user: SessionUser, projectId: string, debateId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);
  return prisma.debate.findFirst({
    where: { id: debateId, projectId },
    include: { turns: { orderBy: { seq: 'asc' } }, cohort: { select: { name: true } } },
  });
}
