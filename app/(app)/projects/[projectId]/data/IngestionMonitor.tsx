'use client';
/**
 * The ingestion command center for one dataset version: metrics, the data-flow strip, the
 * sixteen-stage pipeline, the activity feed and the warning panel — all reduced from the same
 * event stream, with the server's snapshot as the authority on the version's status.
 */
import { useActionState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { INGEST_STAGES, isSettled, type StreamSnapshot, type TelemetryEvent } from '@/telemetry/contract';
import { reduceFlow, reducePipeline, type PipelineState } from '@/telemetry/reduce';
import { useTelemetryStream } from '@/ui/live/useTelemetryStream';
import { ConnectionStatus } from '@/ui/components/ConnectionStatus';
import { DataFlowVisualization } from '@/ui/components/DataFlowVisualization';
import { ProcessingPipeline } from '@/ui/components/ProcessingPipeline';
import { ActivityFeed } from '@/ui/components/ActivityFeed';
import { MetricCard, MetricGrid } from '@/ui/components/MetricCard';
import { LiveAnnouncer } from '@/ui/components/LiveAnnouncer';
import { ErrorState } from '@/ui/components/States';
import { Icon } from '@/ui/components/Icon';
import { retryIngestAction, type FormState } from '../actions';

const STATUS_WORD: Record<string, string> = {
  AWAITING_UPLOAD: 'Waiting for files',
  UPLOADING: 'Queued',
  SCANNING: 'Scanning',
  PARSING: 'Reading files',
  PROFILING: 'Profiling',
  MAPPING: 'Mapping',
  VALIDATING: 'Validating',
  DETECTING_SENSITIVE: 'Sensitive-data check',
  READY_FOR_REVIEW: 'Ready for review',
  IMPORTED: 'Imported',
  PARTIALLY_IMPORTED: 'Partly imported',
  FAILED: 'Failed',
};

export function IngestionMonitor({
  projectId,
  datasetVersionId,
  datasetName,
  initialEvents,
  initialSnapshot,
  fallbackPipeline,
  serverTotal,
  fieldCount,
  blockers,
  canRetry,
}: {
  projectId: string;
  datasetVersionId: string;
  datasetName: string;
  initialEvents: TelemetryEvent[];
  initialSnapshot: StreamSnapshot;
  fallbackPipeline: PipelineState;
  serverTotal: number;
  fieldCount: number;
  blockers: string[];
  canRetry: boolean;
}) {
  const router = useRouter();
  const stream = useTelemetryStream({ projectId, scope: { datasetVersionId }, initialEvents, initialSnapshot });
  const status = stream.snapshot?.dataset?.status ?? initialSnapshot.dataset?.status ?? 'AWAITING_UPLOAD';

  const pipeline = useMemo(() => {
    const fromEvents = reducePipeline(stream.events);
    return fromEvents.source === 'empty' ? fallbackPipeline : fromEvents;
  }, [stream.events, fallbackPipeline]);
  const flow = useMemo(() => reduceFlow(pipeline), [pipeline]);

  // When the version settles while this page is open, re-render the server sections (fields,
  // findings, quality) once. The trigger is the server's own status, never a timer.
  const wasSettled = useRef(isSettled(initialSnapshot));
  useEffect(() => {
    const now = stream.snapshot ? isSettled(stream.snapshot) : false;
    if (now && !wasSettled.current) router.refresh();
    wasSettled.current = now;
  }, [stream.snapshot, router]);

  const problems = useMemo(
    () => stream.events.filter((e) => e.status === 'warning' || e.status === 'failed' || e.status === 'retryable' || (e.status === 'skipped' && e.severity === 'warning')),
    [stream.events],
  );
  // Only a stage that is failed *now* is reported — a failure a retry has since cleared is history, kept in the feed.
  const failure = pipeline.failed
    ? [...stream.events].reverse().find((e) => e.stage === pipeline.failed && (e.status === 'failed' || e.status === 'retryable'))
    : undefined;

  const activeLabel = pipeline.active ? INGEST_STAGES.find((s) => s.key === pipeline.active)?.label ?? null : null;
  const announcement = status === 'FAILED'
    ? `Ingestion of ${datasetName} failed.`
    : isSettledStatus(status)
      ? `${datasetName}: ${STATUS_WORD[status] ?? status}.`
      : activeLabel
        ? `${datasetName}: ${activeLabel}.`
        : null;

  const [retryState, retry] = useActionState(retryIngestAction, {} as FormState);
  const rows = stream.snapshot?.dataset?.rowCount ?? null;
  const quality = stream.snapshot?.dataset?.qualityScore ?? null;

  return (
    <section aria-labelledby="monitor-title" className="flex flex-col gap-3">
      <LiveAnnouncer message={announcement} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="monitor-title" className="text-lg">
          Ingestion <span className="font-sans text-sm font-normal text-ink-muted">· {datasetName}</span>
        </h2>
        <ConnectionStatus state={stream.connection} lastEventAt={stream.lastEventAt} />
      </div>

      <MetricGrid label="Ingestion metrics" className="xl:grid-cols-5">
        <MetricCard label="Status" value={STATUS_WORD[status] ?? status} definition="The version's recorded status in the database." tone={status === 'FAILED' ? 'danger' : isSettledStatus(status) ? 'ok' : 'info'} live={!isSettledStatus(status)} compact />
        <MetricCard label="Rows" value={rows === null ? null : rows.toLocaleString()} definition="Rows parsed across every file and sheet. Unavailable until parsing completes." compact />
        <MetricCard label="Fields" value={fieldCount || null} definition="Fields recorded against this version." compact />
        <MetricCard label="Stages" value={`${pipeline.completedCount}/${INGEST_STAGES.length}`} definition="Pipeline stages finished, including those completed with warnings or not performed." compact />
        <MetricCard label="Quality" value={quality} unit={quality === null ? undefined : '/100'} definition="Five weighted components. Describes the file, not whether it answers your question." compact />
      </MetricGrid>

      {failure && (
        <ErrorState
          title={`Stopped at: ${INGEST_STAGES.find((s) => s.key === failure.stage)?.label ?? failure.stage}`}
          cause={failure.message}
          remedy={failure.retryable ? 'A retry is scheduled by the queue. This panel follows it.' : canRetry && status === 'FAILED' ? 'Check the file errors below, then retry ingestion or upload a corrected file.' : 'Upload a corrected file, or ask a collaborator with upload rights to retry.'}
          correlationId={failure.correlationId}
        />
      )}
      {canRetry && status === 'FAILED' && (
        <form action={retry} className="flex items-center gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="datasetVersionId" value={datasetVersionId} />
          <button type="submit" className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink hover:border-brand">
            <Icon name="retry" size={14} /> Retry ingestion
          </button>
          {retryState.ok && <span role="status" className="text-xs text-ok">{retryState.ok}</span>}
          {retryState.error && <span role="alert" className="text-xs text-danger">{retryState.error}</span>}
        </form>
      )}

      <DataFlowVisualization nodes={flow} />
      <ProcessingPipeline pipeline={pipeline} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ActivityFeed
          events={stream.events}
          title="Processing activity"
          heightClass="h-[22rem]"
          serverTotal={serverTotal}
          emptyText="No ingestion events recorded for this version."
        />
        <section className="panel flex flex-col" aria-labelledby="exceptions-title">
          <div className="panel-head">
            <h3 id="exceptions-title" className="font-sans text-sm font-medium text-ink">Warnings and exceptions</h3>
            <span className="font-mono text-[11px] text-ink-subtle">{problems.length + blockers.length}</span>
          </div>
          <ul className="flex max-h-[24rem] flex-col gap-1.5 overflow-y-auto p-3 text-[12.5px]">
            {blockers.map((b) => (
              <li key={b} className="flex gap-2 rounded border border-warn/40 bg-warn-soft px-2 py-1.5 text-ink">
                <Icon name="hand" size={14} className="mt-0.5 shrink-0 text-warn" />
                <span><span className="sr-only">Outstanding before use: </span>{b}</span>
              </li>
            ))}
            {problems.map((e) => (
              <li key={e.eventId} className="flex gap-2 rounded border border-line px-2 py-1.5 text-ink-muted">
                <Icon name={e.status === 'failed' || e.status === 'retryable' ? 'cross' : 'alert'} size={14} className={e.status === 'failed' || e.status === 'retryable' ? 'mt-0.5 shrink-0 text-danger' : 'mt-0.5 shrink-0 text-warn'} />
                <span className="min-w-0">
                  <span className="font-mono text-[10.5px] uppercase text-ink-subtle">{e.stage.replace(/_/g, ' ')}</span>
                  <span className="block">{e.message}</span>
                  {e.correlationId && <span className="font-mono text-[10.5px] text-ink-subtle">correlation {e.correlationId}</span>}
                </span>
              </li>
            ))}
            {problems.length + blockers.length === 0 && <li className="text-xs text-ink-subtle">Nothing to review.</li>}
          </ul>
        </section>
      </div>
    </section>
  );
}

function isSettledStatus(status: string): boolean {
  return ['READY_FOR_REVIEW', 'IMPORTED', 'PARTIALLY_IMPORTED', 'FAILED'].includes(status);
}
