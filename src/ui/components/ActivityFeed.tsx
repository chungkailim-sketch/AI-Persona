'use client';
/**
 * The activity feed: observation → action → evaluation → result, one row per recorded event.
 *
 * Rows show only what the contract carries — pre-written summaries of structured outputs, never a
 * model's reasoning. Rendering is bounded (the newest `renderLimit` rows; older ones are in the
 * export), off-screen rows skip layout via `content-visibility`, and "Pause display" freezes what
 * is drawn without touching the run: events keep arriving and are counted until display resumes.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { TelemetryEvent } from '@/telemetry/contract';
import { NODE_STATUS_META, VERDICT_META, type EvaluationState } from '@/telemetry/status';
import type { NodeStatus } from '@/telemetry/reduce';
import { Icon } from './Icon';
import { StatusBadge } from './StatusBadge';
import { useReducedMotion } from '../live/useReducedMotion';
import { cn } from '../cn';
import { fmtTime } from '@/lib/time';

const EVENT_STATUS_TO_NODE: Record<TelemetryEvent['status'], NodeStatus> = {
  pending: 'awaiting',
  active: 'active',
  completed: 'completed',
  warning: 'warning',
  failed: 'failed',
  cancelled: 'cancelled',
  retryable: 'retryable',
  skipped: 'not_performed',
};

function verdictOf(e: TelemetryEvent): EvaluationState | null {
  const v = e.safeMetadata?.verdict;
  return v === 'pass' || v === 'flag' || v === 'fail' ? v : null;
}

function stageLabel(stage: string): string {
  return stage === 'run' || stage === 'job' ? stage.toUpperCase() : stage.replace(/_/g, ' ').toLowerCase();
}

export const ActivityFeedRow = memo(function ActivityFeedRow({
  event,
  expanded,
  onToggle,
  enterClass,
}: {
  event: TelemetryEvent;
  expanded: boolean;
  onToggle: () => void;
  enterClass: string;
}) {
  const m = event.safeMetadata ?? {};
  const verdict = verdictOf(event);
  const persona = typeof m.personaKey === 'string' ? m.personaKey : null;
  const isCall = event.eventType === 'run.call.completed';
  const time = fmtTime(event.timestamp);
  const [copied, setCopied] = useState(false);
  const detailsId = `ev-${event.eventId}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <li className={cn('feed-row border-b border-line/70 px-3 py-1.5', enterClass)} data-event-type={event.eventType} data-verdict={verdict ?? undefined}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="mt-0.5 rounded p-0.5 text-ink-subtle hover:text-ink"
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
          <span className="sr-only">{expanded ? 'Collapse' : 'Expand'} event details</span>
        </button>
        <div className="min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed text-telemetry-ink">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <time dateTime={event.timestamp} className="text-ink-subtle">[{time}]</time>
            {persona ? (
              <span className="font-medium">
                {persona}
                {typeof m.stepIndex === 'number' && <span className="text-ink-subtle"> · Step {m.stepIndex}/{m.stepTotal ?? 8}</span>}
              </span>
            ) : (
              <span className="uppercase tracking-wide text-ink-muted">{stageLabel(event.stage)}</span>
            )}
            {verdict ? (
              <StatusBadge size="xs" meta={VERDICT_META[verdict]} label={`${VERDICT_META[verdict].label}${typeof m.score === 'number' ? ` · ${m.score.toFixed(2)}` : ''}`} />
            ) : (
              event.status !== 'active' && <StatusBadge size="xs" meta={NODE_STATUS_META[EVENT_STATUS_TO_NODE[event.status]]} />
            )}
            {event.isMock && <span className="rounded-sm border border-warn/40 px-1 text-[9.5px] uppercase text-warn">mock</span>}
          </div>
          {isCall ? (
            <dl className="mt-0.5 grid grid-cols-[5.5rem_1fr] gap-x-2 font-sans text-[12px] text-ink-muted">
              <dt className="text-ink-subtle">Observation</dt>
              <dd className="min-w-0">{String(m.observation ?? '—')}</dd>
              <dt className="text-ink-subtle">Action</dt>
              <dd className="min-w-0 text-ink">{String(m.action ?? '—')}</dd>
              <dt className="text-ink-subtle">Evaluation</dt>
              <dd className="min-w-0">{String(m.evaluation ?? '—')}</dd>
            </dl>
          ) : (
            <p className="mt-0.5 font-sans text-[12px] text-ink-muted">{event.message}</p>
          )}
          {expanded && (
            <div id={detailsId} className="mt-1.5 rounded border border-line bg-surface p-2 font-sans text-[11.5px] text-ink-muted">
              <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5">
                <dt className="text-ink-subtle">Event</dt>
                <dd className="font-mono">{event.eventType}</dd>
                <dt className="text-ink-subtle">Stage</dt>
                <dd className="font-mono">{event.stage}</dd>
                <dt className="text-ink-subtle">Status</dt>
                <dd className="font-mono">{event.status} · {event.severity}</dd>
                {event.progressTotal !== null && (
                  <>
                    <dt className="text-ink-subtle">Progress</dt>
                    <dd className="font-mono">{event.progressCurrent ?? 0}/{event.progressTotal}</dd>
                  </>
                )}
                {typeof m.attempt === 'number' && (
                  <>
                    <dt className="text-ink-subtle">Attempts</dt>
                    <dd className="font-mono">{m.attempt}{typeof m.outcome === 'string' ? ` · ${m.outcome}` : ''}</dd>
                  </>
                )}
                {typeof m.inputTokens === 'number' && (
                  <>
                    <dt className="text-ink-subtle">Tokens · cost</dt>
                    <dd className="font-mono">{m.inputTokens} in / {Number(m.outputTokens ?? 0)} out · ${Number(m.costUsd ?? 0).toFixed(4)} · {Number(m.latencyMs ?? 0)}ms</dd>
                  </>
                )}
                {typeof m.evidenceCount === 'number' && (
                  <>
                    <dt className="text-ink-subtle">Evidence</dt>
                    <dd>{m.evidenceCount} item(s) cited — traceable in the report&apos;s evidence drawer once the run completes.</dd>
                  </>
                )}
                {event.correlationId && (
                  <>
                    <dt className="text-ink-subtle">Correlation</dt>
                    <dd className="break-all font-mono">{event.correlationId}</dd>
                  </>
                )}
                {event.retryable && (
                  <>
                    <dt className="text-ink-subtle">Retry</dt>
                    <dd>Retryable — the queue decides whether and when.</dd>
                  </>
                )}
                <dt className="text-ink-subtle">Sequence</dt>
                <dd className="font-mono">#{event.seq}</dd>
              </dl>
              <button type="button" onClick={copy} className="mt-1.5 inline-flex items-center gap-1 rounded border border-line px-2 py-0.5 text-[11px] hover:border-line-strong">
                <Icon name="copy" size={12} />
                {copied ? 'Copied' : 'Copy safe details'}
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
});

export interface ActivityFeedProps {
  events: TelemetryEvent[];
  title?: string;
  /** Only events matching this predicate are shown (e.g. one source type). */
  include?: (e: TelemetryEvent) => boolean;
  exportHref?: string | null;
  renderLimit?: number;
  heightClass?: string;
  emptyText?: string;
  /** Total events on the server, when known — to say how many are not held in the browser. */
  serverTotal?: number | null;
}

export function ActivityFeed({
  events,
  title = 'Activity',
  include,
  exportHref,
  renderLimit = 400,
  heightClass = 'h-[28rem]',
  emptyText = 'No activity recorded yet.',
  serverTotal,
}: ActivityFeedProps) {
  const reduced = useReducedMotion();
  const [follow, setFollow] = useState(true);
  const [paused, setPaused] = useState<TelemetryEvent[] | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [persona, setPersona] = useState('all');
  const [stage, setStage] = useState('all');
  const [type, setType] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [unseen, setUnseen] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const seenCount = useRef(0);
  const mounted = useRef(false);

  const base = useMemo(() => (include ? events.filter(include) : events), [events, include]);
  const shownSource = paused ?? base;

  const personas = useMemo(
    () => [...new Set(base.map((e) => e.safeMetadata?.personaKey).filter((x): x is string => typeof x === 'string'))].sort(),
    [base],
  );
  const stages = useMemo(() => [...new Set(base.map((e) => e.stage))], [base]);
  const types = useMemo(() => [...new Set(base.map((e) => e.eventType))].sort(), [base]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shownSource.filter((e) => {
      if (persona !== 'all' && e.safeMetadata?.personaKey !== persona) return false;
      if (stage !== 'all' && e.stage !== stage) return false;
      if (type !== 'all' && e.eventType !== type) return false;
      if (status !== 'all') {
        const v = verdictOf(e);
        if (status === 'problems') {
          if (!(v === 'fail' || v === 'flag' || e.status === 'failed' || e.status === 'warning' || e.status === 'retryable')) return false;
        } else if (v !== status && e.status !== status) return false;
      }
      if (q) {
        const hay = `${e.message} ${e.eventType} ${e.stage} ${Object.values(e.safeMetadata ?? {}).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [shownSource, query, persona, stage, type, status]);

  const rendered = filtered.length > renderLimit ? filtered.slice(filtered.length - renderLimit) : filtered;

  // New-event counter and follow-live scrolling.
  useEffect(() => {
    const grew = base.length - seenCount.current;
    seenCount.current = base.length;
    if (!mounted.current) {
      mounted.current = true;
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      return;
    }
    if (grew <= 0) return;
    if (follow && !paused) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
    } else {
      setUnseen((n) => n + grew);
    }
  }, [base.length, follow, paused, reduced]);

  const jumpToLatest = () => {
    setPaused(null);
    setFollow(true);
    setUnseen(0);
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'auto' }));
  };

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectCls = 'rounded border border-line-strong bg-input px-1.5 py-1 text-[12px] text-ink';

  return (
    <section className="panel flex min-w-0 flex-col" aria-labelledby="feed-title">
      <div className="panel-head flex-wrap">
        <h3 id="feed-title" className="font-sans text-sm font-medium text-ink">{title}</h3>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <label className="inline-flex items-center gap-1.5 text-ink-muted">
            <input type="checkbox" checked={follow} onChange={(e) => { setFollow(e.target.checked); if (e.target.checked) jumpToLatest(); }} className="accent-[var(--color-brand)]" />
            Auto-scroll
          </label>
          <button
            type="button"
            onClick={() => (paused ? jumpToLatest() : setPaused(base))}
            aria-pressed={Boolean(paused)}
            className="inline-flex items-center gap-1 rounded border border-line-strong px-2 py-0.5 text-ink-muted hover:text-ink"
          >
            <Icon name={paused ? 'resume' : 'pause'} size={12} />
            {paused ? 'Resume display' : 'Pause display'}
          </button>
          {exportHref && (
            <a href={exportHref} className="inline-flex items-center gap-1 rounded border border-line-strong px-2 py-0.5 text-ink-muted hover:text-ink">
              <Icon name="download" size={12} />
              Export
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2" role="group" aria-label="Filter activity">
        <label className="relative flex min-w-[10rem] flex-1 items-center">
          <span className="sr-only">Search activity</span>
          <Icon name="search" size={13} className="pointer-events-none absolute left-2 text-ink-subtle" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full rounded border border-line-strong bg-input py-1 pl-7 pr-2 text-[12px] text-ink placeholder:text-ink-subtle"
          />
        </label>
        <label className="sr-only" htmlFor="feed-status">Status</label>
        <select id="feed-status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          <option value="all">All statuses</option>
          <option value="problems">Problems only</option>
          <option value="pass">Pass</option>
          <option value="flag">Flag</option>
          <option value="fail">Fail</option>
          <option value="completed">Completed</option>
          <option value="warning">Warning</option>
          <option value="failed">Failed</option>
        </select>
        {personas.length > 0 && (
          <>
            <label className="sr-only" htmlFor="feed-persona">Persona</label>
            <select id="feed-persona" value={persona} onChange={(e) => setPersona(e.target.value)} className={selectCls}>
              <option value="all">All personas</option>
              {personas.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </>
        )}
        <label className="sr-only" htmlFor="feed-stage">Stage</label>
        <select id="feed-stage" value={stage} onChange={(e) => setStage(e.target.value)} className={selectCls}>
          <option value="all">All stages</option>
          {stages.map((s) => (
            <option key={s} value={s}>{stageLabel(s)}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="feed-type">Event type</label>
        <select id="feed-type" value={type} onChange={(e) => setType(e.target.value)} className={selectCls}>
          <option value="all">All event types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={listRef} className={cn('overflow-y-auto bg-telemetry', heightClass)} tabIndex={0} aria-label={`${title} — ${filtered.length} event(s)`}>
          {rendered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-subtle">{base.length === 0 ? emptyText : 'No events match these filters.'}</p>
          ) : (
            <ol aria-live="off">
              {rendered.map((e) => (
                <ActivityFeedRow
                  key={e.eventId}
                  event={e}
                  expanded={expanded.has(e.eventId)}
                  onToggle={() => toggle(e.eventId)}
                  enterClass={reduced ? '' : 'motion-enter'}
                />
              ))}
            </ol>
          )}
        </div>
        {(unseen > 0 || paused) && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-brand bg-surface px-3 py-1 text-[12px] text-brand shadow-pop"
          >
            <Icon name="arrowDown" size={12} />
            {paused ? `Display paused · ${Math.max(0, base.length - paused.length)} new` : `${unseen} new event${unseen === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
      <p className="border-t border-line px-3 py-1.5 font-mono text-[10.5px] text-ink-subtle">
        Showing {rendered.length} of {filtered.length} matching
        {serverTotal != null && serverTotal > events.length ? ` · ${serverTotal - events.length} older event(s) on the server${exportHref ? ' — in the export' : ''}` : ''}
        {paused ? ' · display paused, the run continues' : ''}
      </p>
    </section>
  );
}
