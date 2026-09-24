/**
 * Writing telemetry (server only).
 *
 * Same rule as the audit log: recording what happened must never break the thing that happened. A
 * failed write is logged to the server and swallowed. Every event is sanitised against the
 * contract's allow-list before it reaches the database, so a careless caller cannot put a source
 * value or a model's reasoning into the stream.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { sanitizeMetadata, type EventStatus, type Severity, type SourceType } from './contract';

export interface EmitInput {
  eventType: string;
  sourceType: SourceType;
  sourceId: string;
  projectId: string;
  datasetVersionId?: string | null;
  cohortId?: string | null;
  runId?: string | null;
  stage: string;
  status: EventStatus;
  message: string;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  metricName?: string | null;
  metricValue?: number | null;
  severity?: Severity;
  retryable?: boolean;
  correlationId?: string | null;
  isMock?: boolean;
  safeMetadata?: Record<string, unknown> | null;
}

/** Disable writes (used by a few unit tests that exercise instrumented code without a database). */
let disabled = false;
export function setTelemetryEnabled(on: boolean): void {
  disabled = !on;
}

export async function emitTelemetry(input: EmitInput): Promise<void> {
  if (disabled) return;
  try {
    const metadata = sanitizeMetadata(input.safeMetadata ?? null);
    await prisma.telemetryEvent.create({
      data: {
        eventId: randomUUID(),
        eventType: input.eventType.slice(0, 80),
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        projectId: input.projectId,
        datasetVersionId: input.datasetVersionId ?? null,
        cohortId: input.cohortId ?? null,
        runId: input.runId ?? null,
        stage: input.stage.slice(0, 60),
        status: input.status,
        message: input.message.slice(0, 500),
        progressCurrent: input.progressCurrent ?? null,
        progressTotal: input.progressTotal ?? null,
        metricName: input.metricName ?? null,
        metricValue: input.metricValue ?? null,
        severity: input.severity ?? (input.status === 'failed' ? 'error' : input.status === 'warning' ? 'warning' : 'info'),
        retryable: input.retryable ?? false,
        correlationId: input.correlationId ?? null,
        isMock: input.isMock ?? false,
        safeMetadata: (metadata ?? undefined) as object | undefined,
      },
    });
  } catch (e) {
    console.error('[telemetry] failed to record event', {
      eventType: input.eventType,
      stage: input.stage,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** A bound emitter for one dataset version, resolving its project once. */
export async function datasetEmitter(datasetVersionId: string, correlationId?: string | null) {
  const version = await prisma.datasetVersion
    .findUnique({
      where: { id: datasetVersionId },
      select: { dataset: { select: { projects: { select: { projectId: true }, take: 1 } } } },
    })
    .catch(() => null);
  const projectId = version?.dataset.projects[0]?.projectId ?? null;

  return async (e: Omit<EmitInput, 'sourceType' | 'sourceId' | 'projectId' | 'datasetVersionId'>) => {
    if (!projectId) return;
    await emitTelemetry({
      ...e,
      sourceType: 'dataset',
      sourceId: datasetVersionId,
      projectId,
      datasetVersionId,
      correlationId: e.correlationId ?? correlationId ?? null,
    });
  };
}
