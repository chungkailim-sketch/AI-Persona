import type { TelemetryEvent } from '../../src/telemetry/contract';

let seq = 0;
export function ev(partial: Partial<TelemetryEvent> & Pick<TelemetryEvent, 'stage' | 'status'>): TelemetryEvent {
  seq += 1;
  return {
    eventId: `e-${seq}-${Math.random().toString(36).slice(2, 8)}`,
    seq: partial.seq ?? seq,
    eventType: 'ingest.stage',
    sourceType: 'dataset',
    sourceId: 'v1',
    projectId: 'p1',
    datasetVersionId: 'v1',
    cohortId: null,
    runId: null,
    message: 'm',
    progressCurrent: null,
    progressTotal: null,
    metricName: null,
    metricValue: null,
    severity: 'info',
    timestamp: new Date(Date.UTC(2026, 8, 21, 8, 0, 0) + seq * 1000).toISOString(),
    retryable: false,
    correlationId: null,
    isMock: false,
    safeMetadata: null,
    ...partial,
  };
}

export function runEv(partial: Partial<TelemetryEvent> & Pick<TelemetryEvent, 'stage' | 'status'>): TelemetryEvent {
  return ev({ sourceType: 'run', sourceId: 'r1', runId: 'r1', datasetVersionId: null, eventType: 'run.stage', ...partial });
}

export function call(stage: string, personaKey: string, verdict: 'pass' | 'flag' | 'fail', extra: Record<string, unknown> = {}, index = 1, total = 3): TelemetryEvent {
  return runEv({
    stage,
    status: verdict === 'fail' ? 'warning' : 'completed',
    eventType: 'run.call.completed',
    progressCurrent: index,
    progressTotal: total,
    safeMetadata: { personaKey, verdict, attempt: verdict === 'flag' ? 2 : 1, inputTokens: 100, outputTokens: 20, costUsd: 0.001, ...extra } as TelemetryEvent['safeMetadata'],
  });
}
