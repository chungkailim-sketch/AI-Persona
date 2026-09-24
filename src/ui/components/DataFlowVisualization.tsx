'use client';
import type { FlowNodeState } from '@/telemetry/reduce';
import { NODE_STATUS_META } from '@/telemetry/status';
import { useReducedMotion } from '../live/useReducedMotion';
import { Icon } from './Icon';
import { TONE_BADGE } from './tone';
import { cn } from '../cn';

/**
 * Source → validation → parsing → profiling → sensitive review → evidence → ready.
 *
 * The moving dash runs only on the connector *into* the active node, and only while that node is
 * active in the recorded state — it cannot run ahead of the data. Under reduced motion the dash is
 * static and the status words carry everything. The ordered list is the textual equivalent.
 */
export function DataFlowVisualization({ nodes }: { nodes: FlowNodeState[] }) {
  const reduced = useReducedMotion();
  const activeIndex = nodes.findIndex((n) => n.status === 'active');
  const summary = nodes.map((n) => `${n.label}: ${NODE_STATUS_META[n.status].label}`).join('; ');

  return (
    <figure className="panel" aria-labelledby="flow-title">
      <figcaption className="panel-head">
        <span id="flow-title" className="text-sm font-medium text-ink">Data flow</span>
        <span className="sr-only">{summary}</span>
      </figcaption>
      <ol className="grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-4 xl:grid-cols-7" aria-label="Data flow stages">
        {nodes.map((n, i) => {
          const meta = NODE_STATUS_META[n.status];
          const connectorLive = i === activeIndex && !reduced;
          const connectorDone = n.status !== 'pending' && n.status !== 'active' && n.status !== 'awaiting';
          return (
            <li key={n.key} className="flex min-w-0 items-center" data-flow-status={n.status}>
              {i > 0 && (
                <svg aria-hidden className="mr-1 hidden h-2 w-3 shrink-0 xl:block" viewBox="0 0 12 6">
                  <line
                    x1="0" y1="3" x2="12" y2="3"
                    className={cn(connectorLive && 'motion-flow')}
                    stroke={connectorDone || n.status === 'active' ? 'var(--color-brand)' : 'var(--color-line-strong)'}
                    strokeWidth="2"
                    strokeDasharray={connectorDone ? undefined : '3 3'}
                  />
                </svg>
              )}
              <div className={cn('motion-color flex min-w-0 flex-1 items-start gap-1.5 rounded border px-2 py-1.5', TONE_BADGE[meta.tone])}>
                <Icon name={meta.icon} size={13} className={cn('mt-0.5 shrink-0', meta.live && !reduced && 'motion-live')} />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="text-[12px] font-medium">{n.label}</span>
                  <span className="font-mono text-[9.5px] uppercase tracking-wide opacity-90">{meta.label}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
