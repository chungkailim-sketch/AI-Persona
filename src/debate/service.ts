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

// ── What is made from a completed debate ──────────────────────────────────────

export interface InsightRequest {
  kind: 'PANEL_QUESTION' | 'COMMS_REPORT' | 'SELF_INTRO' | 'INTERVIEW';
  prompt?: string | null;
  /** A persona agent key, or 'all' for self-introductions from every persona agent. */
  agentKey?: string | null;
  options?: Record<string, unknown>;
}

/**
 * Queue something to be made from a completed debate. Spends model budget, so it needs the same
 * permission as the debate itself, and is audited.
 */
export async function requestInsight(user: SessionUser, projectId: string, debateId: string, input: InsightRequest): Promise<{ artifactIds: string[] }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'simulation.run', projectId)) throw new AuthorizationError('simulation.run', projectId);

  const problems: string[] = [];
  const debate = await prisma.debate.findFirst({ where: { id: debateId, projectId }, select: { id: true, status: true, agents: true } });
  if (!debate) throw new DebateRequestRefused(['That debate is not part of this project.']);
  if (debate.status !== 'COMPLETED') problems.push('Wait for the debate to complete first.');
  const personaKeys = ((debate.agents ?? []) as { key: string; kind: string }[]).filter((a) => a.kind === 'persona').map((a) => a.key);

  const prompt = input.prompt?.trim() || null;
  let agentKeys: (string | null)[] = [null];
  if (input.kind === 'PANEL_QUESTION' || input.kind === 'INTERVIEW') {
    if (!prompt || prompt.length < 8) problems.push('Enter the question in at least a few words.');
    else if (prompt.length > 1500) problems.push('Keep the question under 1,500 characters.');
  } else if (prompt && prompt.length > 3000) problems.push('Keep the brief under 3,000 characters.');
  if (input.kind === 'INTERVIEW' || input.kind === 'SELF_INTRO') {
    if (input.kind === 'SELF_INTRO' && input.agentKey === 'all') agentKeys = personaKeys;
    else if (input.agentKey && personaKeys.includes(input.agentKey)) agentKeys = [input.agentKey];
    else problems.push('Choose a persona from this debate.');
  }
  const options: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.options ?? {})) {
    if (Array.isArray(v)) options[k] = v.map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 16);
    else if (v !== null && v !== undefined && String(v).trim()) options[k] = String(v).trim().slice(0, 300);
  }
  if (problems.length > 0) throw new DebateRequestRefused(problems);

  const artifactIds: string[] = [];
  for (const agentKey of agentKeys) {
    const a = await prisma.debateArtifact.create({
      data: { debateId, projectId, kind: input.kind, agentKey, prompt, options: options as object, createdById: user.userId },
    });
    await enqueue({ kind: 'debate_insight', input: { artifactId: a.id }, idempotencyKey: `debate_insight:${a.id}`, maxAttempts: 1 });
    artifactIds.push(a.id);
  }
  await recordAudit({
    action: 'debate.insight_requested',
    targetType: 'debate',
    targetId: debateId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    reason: `${input.kind.toLowerCase().replace('_', ' ')} requested (${artifactIds.length})`,
  });
  return { artifactIds };
}

export async function listInsights(user: SessionUser, projectId: string, debateId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);
  return prisma.debateArtifact.findMany({ where: { debateId, projectId }, orderBy: { createdAt: 'asc' } });
}
