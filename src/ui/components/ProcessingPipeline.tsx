import { INGEST_STAGES, type IngestStageKey } from '@/telemetry/contract';
import type { NodeState, PipelineState } from '@/telemetry/reduce';
import { NODE_STATUS_META } from '@/telemetry/status';
import { Icon } from './Icon';
import { TONE_BADGE, TONE_BORDER } from './tone';
import { cn } from '../cn';

export function PipelineNode({ index, label, description, node, compact }: { index: number; label: string; description: string; node: NodeState; compact?: boolean }) {
  const meta = NODE_STATUS_META[node.status];
  return (
    <li
      className={cn('motion-color flex items-start gap-2.5 rounded border bg-surface px-2.5 py-2', TONE_BORDER[meta.tone], node.status === 'active' && 'ring-1 ring-info/40')}
      data-stage-status={node.status}
      aria-current={node.status === 'active' ? 'step' : undefined}
    >
      <span className={cn('mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', TONE_BADGE[meta.tone])} aria-hidden>
        {node.status === 'pending' ? (
          <span className="font-mono text-[9.5px]">{index}</span>
        ) : (
          <Icon name={meta.icon} size={12} className={meta.live ? 'motion-live' : undefined} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-[13px] font-medium text-ink">{label}</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink-subtle">{meta.label}</span>
        </span>
        {!compact && (
          <span className="block text-[11.5px] leading-snug text-ink-muted">
            {node.message ?? description}
            {node.warnings > 1 && <span className="ml-1 font-mono text-warn">({node.warnings} warnings)</span>}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * The sixteen ingestion stages. Every state shown is the reduction of recorded events (or, for
 * versions ingested before events existed, a reconstruction that says so). A failed stage stops
 * the column: nothing after it is shown as progressing.
 */
export function ProcessingPipeline({ pipeline, compact }: { pipeline: PipelineState; compact?: boolean }) {
  const done = pipeline.completedCount;
  const activeLabel = pipeline.active ? INGEST_STAGES.find((s) => s.key === pipeline.active)?.label : null;
  const failedLabel = pipeline.failed ? INGEST_STAGES.find((s) => s.key === pipeline.failed)?.label : null;
  return (
    <section aria-labelledby="pipeline-title" className="panel">
      <div className="panel-head">
        <h3 id="pipeline-title" className="font-sans text-sm font-medium text-ink">Processing pipeline</h3>
        <span className="font-mono text-[11px] text-ink-subtle">{done}/{INGEST_STAGES.length} stages</span>
      </div>
      <p className="sr-only" aria-live="off">
        {`${done} of ${INGEST_STAGES.length} stages finished.`}
        {activeLabel ? ` Active: ${activeLabel}.` : ''}
        {failedLabel ? ` Failed at: ${failedLabel}.` : ''}
      </p>
      {pipeline.source === 'status' && (
        <p className="border-b border-line bg-pending-soft px-3.5 py-2 text-[11.5px] text-pending">
          Per-stage events were not recorded for this version; states are reconstructed from its recorded status.
        </p>
      )}
      <ol className="grid gap-1.5 p-3 sm:grid-cols-2 xl:grid-cols-3">
        {INGEST_STAGES.map((s, i) => (
          <PipelineNode key={s.key} index={i + 1} label={s.label} description={s.description} node={pipeline.stages[s.key as IngestStageKey]} compact={compact} />
        ))}
      </ol>
    </section>
  );
}
