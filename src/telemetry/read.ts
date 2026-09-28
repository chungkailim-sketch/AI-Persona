/**
 * Reading telemetry (server only).
 *
 * Every read is scoped twice: to a project the caller may view, and — when a run or dataset
 * version is named — to a subject that actually belongs to that project. The second check is what
 * stops a member of project A from reading project B's run by pasting its id into A's stream URL.
 */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import type { StreamSnapshot, TelemetryEvent } from './contract';
import type { TelemetryEvent as TelemetryRow } from '@/generated/prisma/client';

export class StreamRefused extends Error {
  constructor() {
    super('Not found.');
    this.name = 'StreamRefused';
  }
}

export interface StreamScope {
  projectId: string;
  runId?: string | null;
  datasetVersionId?: string | null;
  cohortId?: string | null;
}

/**
 * Decide whether `user` may read events for `scope`. Throws `StreamRefused` — which callers turn
 * into a 404, never a 403, so the response does not confirm that the subject exists.
 */
export async function authorizeStream(user: SessionUser, scope: StreamScope): Promise<void> {
  const ctx = await authContextFor(user, scope.projectId);
  if (!can(ctx, 'project.view', scope.projectId)) throw new StreamRefused();

  if (scope.runId) {
    const run = await prisma.run.findFirst({ where: { id: scope.runId, projectId: scope.projectId }, select: { id: true } });
    if (!run) throw new StreamRefused();
  }
  if (scope.datasetVersionId) {
    const v = await prisma.datasetVersion.findFirst({
      where: { id: scope.datasetVersionId, dataset: { projects: { some: { projectId: scope.projectId } } } },
      select: { id: true },
    });
    if (!v) throw new StreamRefused();
  }
  if (scope.cohortId) {
    const c = await prisma.cohort.findFirst({ where: { id: scope.cohortId, projectId: scope.projectId }, select: { id: true } });
    if (!c) throw new StreamRefused();
  }
}

export function toContract(row: TelemetryRow): TelemetryEvent {
  return {
    eventId: row.eventId,
    seq: Number(row.seq),
    eventType: row.eventType,
    sourceType: row.sourceType as TelemetryEvent['sourceType'],
    sourceId: row.sourceId,
    projectId: row.projectId,
    datasetVersionId: row.datasetVersionId,
    cohortId: row.cohortId,
    runId: row.runId,
    stage: row.stage,
    status: row.status as TelemetryEvent['status'],
    message: row.message,
    progressCurrent: row.progressCurrent,
    progressTotal: row.progressTotal,
    metricName: row.metricName,
    metricValue: row.metricValue,
    severity: row.severity as TelemetryEvent['severity'],
    timestamp: row.createdAt.toISOString(),
    retryable: row.retryable,
    correlationId: row.correlationId,
    isMock: row.isMock,
    safeMetadata: (row.safeMetadata as TelemetryEvent['safeMetadata']) ?? null,
  };
}

function whereFor(scope: StreamScope) {
  return {
    projectId: scope.projectId,
    ...(scope.runId ? { runId: scope.runId } : {}),
    ...(scope.datasetVersionId ? { datasetVersionId: scope.datasetVersionId } : {}),
    ...(scope.cohortId ? { cohortId: scope.cohortId } : {}),
  };
}

/** Events after `afterSeq`, oldest first. Callers must have called `authorizeStream` first. */
export async function readEventsAfter(scope: StreamScope, afterSeq: number, limit = 500): Promise<TelemetryEvent[]> {
  const rows = await prisma.telemetryEvent.findMany({
    where: { ...whereFor(scope), seq: { gt: BigInt(Math.max(0, Math.floor(afterSeq))) } },
    orderBy: { seq: 'asc' },
    take: Math.min(Math.max(limit, 1), 1000),
  });
  return rows.map(toContract);
}

/**
 * The newest `limit` events, oldest first — what a page renders on first load so the feed is not
 * empty while the stream connects. Older events stay on the server and in the export.
 */
export async function readRecentEvents(scope: StreamScope, limit = 300): Promise<TelemetryEvent[]> {
  const rows = await prisma.telemetryEvent.findMany({
    where: whereFor(scope),
    orderBy: { seq: 'desc' },
    take: Math.min(Math.max(limit, 1), 1000),
  });
  return rows.reverse().map(toContract);
}

export async function countEvents(scope: StreamScope): Promise<number> {
  return prisma.telemetryEvent.count({ where: whereFor(scope) });
}

/** The authoritative state of the stream's subject, read from the tables of record, not from events. */
export async function readSnapshot(scope: StreamScope): Promise<StreamSnapshot> {
  const last = await prisma.telemetryEvent.findFirst({
    where: whereFor(scope),
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });

  let run: StreamSnapshot['run'] = null;
  if (scope.runId) {
    const r = await prisma.run.findUnique({
      where: { id: scope.runId },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });
    if (r) {
      const agg = await prisma.modelCall.aggregate({
        where: { runId: r.id },
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _count: true,
      });
      run = {
        id: r.id,
        status: r.status,
        isMock: r.isMock,
        startedAt: r.startedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        cancelRequested: r.cancelRequested,
        failureReason: r.failureReason,
        calls: agg._count,
        inputTokens: agg._sum.inputTokens ?? 0,
        outputTokens: agg._sum.outputTokens ?? 0,
        costUsd: agg._sum.costUsd ?? 0,
        steps: r.steps.map((s) => ({ stage: s.stage, status: s.status, durationMs: s.durationMs })),
      };
    }
  }

  let dataset: StreamSnapshot['dataset'] = null;
  if (scope.datasetVersionId) {
    const v = await prisma.datasetVersion.findUnique({
      where: { id: scope.datasetVersionId },
      select: { id: true, status: true, rowCount: true, qualityScore: true },
    });
    if (v) dataset = { versionId: v.id, status: v.status, rowCount: v.rowCount, qualityScore: v.qualityScore };
  }

  return {
    kind: 'snapshot',
    cursor: last ? Number(last.seq) : 0,
    run,
    dataset,
    serverTime: new Date().toISOString(),
  };
}

export { isSettled } from './contract';
