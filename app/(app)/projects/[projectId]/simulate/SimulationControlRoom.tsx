'use client';
/**
 * The simulation control room.
 *
 * Every panel is a reduction of one event stream plus the server's snapshot of the run. Nothing on
 * this screen moves because time passed: stages advance on `run.stage` events, metrics change on
 * `run.call.completed` events, and the snapshot — read from `Run`, `RunStep` and `ModelCall` on
 * every (re)connection — overrides the reduction wherever the two could disagree.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RUN_STAGE_CATALOGUE, isTerminalRunStatus, type StreamSnapshot, type TelemetryEvent } from '@/telemetry/contract';
import {
  aggregateRunMetrics,
  effectiveRunStatus,
  announcementFor,
  preliminaryTally,
  reduceDebateStages,
  reducePersonaActivity,
  reduceRunStages,
} from '@/telemetry/reduce';
import { NODE_STATUS_META, type StatusMeta } from '@/telemetry/status';
import { useTelemetryStream } from '@/ui/live/useTelemetryStream';
import type { EventTransport } from '@/ui/live/transport';
import { ActivityFeed } from '@/ui/components/ActivityFeed';
import { ConnectionStatus } from '@/ui/components/ConnectionStatus';
import { LiveAnnouncer } from '@/ui/components/LiveAnnouncer';
import { LiveMetricChart } from '@/ui/components/LiveMetricChart';
import { MetricCard, MetricGrid } from '@/ui/components/MetricCard';
import { PassFlagFailSummary } from '@/ui/components/PassFlagFailSummary';
import { PersonaStateSummary } from '@/ui/components/PersonaStateSummary';
import { PreliminaryFindingsPanel } from '@/ui/components/PreliminaryFindingsPanel';
import { DebateStageTracker, ProgressBar, RunStageTracker } from '@/ui/components/RunStageTracker';
import { SimulationNotice } from '@/ui/components/SimulationNotice';
import { StatusBadge } from '@/ui/components/StatusBadge';
import { ErrorState } from '@/ui/components/States';
import { cancelRunAction } from '../runActions';

export interface RunHeaderInfo {
  runId: string;
  name: string;
  mode: string;
  projectName: string;
  cohortName: string;
  cohortSize: number;
  personaKeys: string[];
  variants: number;
  modelLabel: string;
  seeds: number[];
  createdAt: string;
  /** From the run's configured provider. `Run.isMock` is only settled when the run finishes. */
  isMock: boolean;
}

const RUN_STATUS_META: Record<string, StatusMeta> = {
  COMPLETED: NODE_STATUS_META.completed,
  COMPLETED_WITH_WARNINGS: NODE_STATUS_META.warning,
  FAILED: NODE_STATUS_META.failed,
  CANCELLED: NODE_STATUS_META.cancelled,
  DRAFT: NODE_STATUS_META.awaiting,
  QUEUED: NODE_STATUS_META.pending,
};

function elapsed(startIso: string | null, endIso: string | null, now: number): string | null {
  if (!startIso) return null;
  const ms = (endIso ? Date.parse(endIso) : now) - Date.parse(startIso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

const hideCallStarts = (e: TelemetryEvent) => e.eventType !== 'run.call.started';

const pct = (x: number | null) => (x === null ? null : `${Math.round(x * 100)}%`);

export function SimulationControlRoom({
  projectId,
  info,
  initialEvents,
  initialSnapshot,
  serverTotal,
  canCancel,
  exportHref,
  resultsHref,
  transport,
  rerun,
}: {
  projectId: string;
  info: RunHeaderInfo;
  initialEvents: TelemetryEvent[];
  initialSnapshot: StreamSnapshot;
  serverTotal: number;
  canCancel: boolean;
  exportHref: string | null;
  resultsHref: string;
  transport?: EventTransport;
  rerun?: React.ReactNode;
}) {
  const router = useRouter();
  const stream = useTelemetryStream({ projectId, scope: { runId: info.runId }, initialEvents, initialSnapshot, transport });
  const run = stream.snapshot?.run ?? initialSnapshot.run;
  const status = effectiveRunStatus(stream.events, run?.status ?? null);
  const terminal = isTerminalRunStatus(status);
  const running = !terminal && status !== 'DRAFT';

  // Elapsed time is a clock reading, not progress — and it stops with the run.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const stages = useMemo(() => reduceRunStages(stream.events, run ?? null), [stream.events, run]);
  // Snapshot says running but events say done: treat the run as settled for metrics too.
  const runForMetrics = useMemo(() => (run ? { ...run, status } : null), [run, status]);
  const debate = useMemo(() => reduceDebateStages(stages, stream.events), [stages, stream.events]);
  const metrics = useMemo(() => aggregateRunMetrics(stream.events, runForMetrics, now), [stream.events, runForMetrics, now]);
  const personas = useMemo(() => reducePersonaActivity(stream.events, info.personaKeys, status), [stream.events, info.personaKeys, status]);
  const tally = useMemo(() => preliminaryTally(stream.events), [stream.events]);
  const activePersonas = [...personas.values()].filter((s) => ['evaluating', 'responding', 'challenging', 'revising', 'retrying'].includes(s)).length;
  const activeStage = RUN_STAGE_CATALOGUE.find((s) => stages[s.key].status === 'active');

  // Announce stage changes, failure and completion — never individual events.
  const prev = useRef<{ stage: string | null; status: string | null }>({ stage: activeStage?.key ?? null, status });
  const [announcement, setAnnouncement] = useState<string | null>(null);
  useEffect(() => {
    const next = { stage: activeStage?.key ?? null, status, stageLabel: activeStage?.label };
    const msg = announcementFor(prev.current, next);
    if (msg) setAnnouncement(msg);
    prev.current = { stage: next.stage, status };
  }, [activeStage?.key, activeStage?.label, status]);

  // Once the run settles while open, refresh the server-rendered parts of the page once.
  const wasTerminal = useRef(terminal);
  useEffect(() => {
    if (terminal && !wasTerminal.current) router.refresh();
    wasTerminal.current = terminal;
  }, [terminal, router]);

  const statusMeta = RUN_STATUS_META[status] ?? { ...NODE_STATUS_META.active, label: status.toLowerCase().replace(/_/g, ' ') };
  const isMock = terminal ? (run?.isMock ?? info.isMock) : info.isMock;

  return (
    <section aria-labelledby="run-title" className="flex flex-col gap-3" data-run-status={status}>
      <LiveAnnouncer message={announcement} assertive={status === 'FAILED'} />

      {/* ── A. Run header ─────────────────────────────────────────────────── */}
      <div className="panel">
        <div className="flex flex-wrap items-start justify-between gap-3 p-3.5">
          <div className="min-w-0">
            <p className="eyebrow">Simulation · {info.mode.toLowerCase().replace(/_/g, ' ')}</p>
            <h2 id="run-title" className="mt-0.5 flex flex-wrap items-center gap-2 text-xl">
              {info.name}
              <StatusBadge meta={statusMeta} label={statusMeta.label} />
              <span className={isMock ? 'rounded-sm border border-warn/40 bg-warn-soft px-1.5 font-mono text-[10px] uppercase text-warn' : 'rounded-sm border border-info/40 bg-info-soft px-1.5 font-mono text-[10px] uppercase text-info'}>
                {isMock ? 'Mock provider' : 'Live model'}
              </span>
            </h2>
            <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-0.5 text-[12px] sm:grid-cols-4">
              <div><dt className="inline text-ink-subtle">Project </dt><dd className="inline text-ink">{info.projectName}</dd></div>
              <div><dt className="inline text-ink-subtle">Run ID </dt><dd className="inline font-mono text-ink">{info.runId.slice(-10)}</dd></div>
              <div><dt className="inline text-ink-subtle">Started </dt><dd className="inline font-mono text-ink">{run?.startedAt ? `${run.startedAt.slice(11, 19)}Z` : 'not yet'}</dd></div>
              <div><dt className="inline text-ink-subtle">Elapsed </dt><dd className="inline font-mono text-ink">{elapsed(run?.startedAt ?? null, run?.completedAt ?? null, now) ?? '—'}</dd></div>
              <div><dt className="inline text-ink-subtle">Cohort </dt><dd className="inline text-ink">{info.cohortName} · {info.cohortSize}</dd></div>
              <div><dt className="inline text-ink-subtle">Professional personas </dt><dd className="inline text-ink">none in this run</dd></div>
              <div><dt className="inline text-ink-subtle">Variants </dt><dd className="inline font-mono text-ink">{info.variants}</dd></div>
              <div><dt className="inline text-ink-subtle">Model </dt><dd className="inline font-mono text-ink">{info.modelLabel}</dd></div>
            </dl>
          </div>
          <div className="flex flex-col items-end gap-2">
            <ConnectionStatus state={stream.connection} lastEventAt={stream.lastEventAt} />
            <div className="flex flex-wrap justify-end gap-2">
              {canCancel && running && !run?.cancelRequested && (
                <form action={cancelRunAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="runId" value={info.runId} />
                  <button type="submit" className="rounded border border-line-strong px-3 py-1.5 text-xs text-ink-muted hover:border-danger hover:text-danger">
                    Cancel run
                  </button>
                </form>
              )}
              {run?.cancelRequested && running && <span className="text-xs text-warn">Cancellation requested — stops at the next checkpoint.</span>}
              {terminal && rerun}
            </div>
          </div>
        </div>
        {running && activeStage && (
          <div className="border-t border-line px-3.5 py-2">
            <span className="text-[12px] text-ink-muted">Stage {RUN_STAGE_CATALOGUE.findIndex((s) => s.key === activeStage.key) + 1} of {RUN_STAGE_CATALOGUE.length}: <span className="text-ink">{activeStage.label}</span></span>
            {metrics.stageProgress && <ProgressBar current={metrics.stageProgress.current} total={metrics.stageProgress.total} tone="info" label={`${activeStage.label} progress`} />}
          </div>
        )}
      </div>

      <SimulationNotice isMock={isMock} compact />

      {status === 'FAILED' && (
        <ErrorState title="The run failed" cause={run?.failureReason ?? 'The cause is recorded in the server log.'} remedy="Fix what the reason names, then plan a new run. Completed stages are kept in the record below." />
      )}

      {/* ── B. Live metrics ───────────────────────────────────────────────── */}
      <MetricGrid label="Run metrics">
        <MetricCard compact live={running && activePersonas > 0} label="Active personas" value={running ? activePersonas : 0} definition="Personas with a model call in flight right now. Calls are made one at a time." />
        <MetricCard compact label="Evaluations" value={metrics.callsCompleted} definition="Model answers received and evaluated against their schema." updatedAt={metrics.lastUpdated} />
        <MetricCard compact label="Throughput" value={metrics.callsPerMinute} unit={metrics.callsPerMinute === null ? undefined : '/min'} definition="Answers completed in the trailing 60 seconds. Unavailable when the run is not active." />
        <MetricCard compact label="Mean confidence" value={metrics.meanConfidence === null ? null : metrics.meanConfidence.toFixed(2)} definition="Mean of the confidence each persona stated. A self-report, not a quality score." />
        <MetricCard compact label="Pass rate" value={pct(metrics.passRate)} tone="ok" definition="Share of answers valid on the first attempt." />
        <MetricCard compact label="Flag rate" value={pct(metrics.flagRate)} tone={metrics.flag > 0 ? 'warn' : undefined} definition="Share valid only after a repair attempt." />
        <MetricCard compact label="Fail rate" value={pct(metrics.failRate)} tone={metrics.fail > 0 ? 'danger' : undefined} definition="Share with no usable answer." />
        <MetricCard compact label="Completion" value={running ? (metrics.stageProgress ? `${metrics.stageProgress.current}/${metrics.stageProgress.total}` : 'in stage') : terminal ? 'finished' : 'not started'} definition="Progress within the current stage. No time estimate is shown: call latency varies too much for one to be reliable." />
        <MetricCard compact label="Tokens" value={(metrics.inputTokens + metrics.outputTokens).toLocaleString()} definition="Input plus output tokens, summed from recorded model calls." />
        <MetricCard compact label="Cost" value={`$${metrics.costUsd.toFixed(4)}`} definition={isMock ? 'The mock provider costs nothing.' : 'Estimated from published token prices; not an invoice.'} />
        <MetricCard compact label="Retries" value={metrics.retries} tone={metrics.retries > 0 ? 'warn' : undefined} definition="Repair attempts after an answer failed its schema." />
        <MetricCard compact label="Warnings" value={metrics.warnings} tone={metrics.warnings > 0 ? 'warn' : undefined} definition="Warning events recorded for this run." />
      </MetricGrid>

      {/* ── C/D. Telemetry and state ──────────────────────────────────────── */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <ActivityFeed
          events={stream.events}
          title="Trajectory telemetry"
          include={hideCallStarts}
          heightClass="h-[34rem]"
          exportHref={exportHref}
          serverTotal={serverTotal}
          emptyText="No activity yet. Events appear as the worker records them."
        />
        <div className="flex min-w-0 flex-col gap-3">
          <RunStageTracker stages={stages} />
          <PassFlagFailSummary pass={metrics.pass} flag={metrics.flag} fail={metrics.fail} pending={running ? activePersonas : null} updatedAt={metrics.lastUpdated} />
          <PreliminaryFindingsPanel tally={tally} resultsHref={resultsHref} completed={status === 'COMPLETED' || status === 'COMPLETED_WITH_WARNINGS'} />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <PersonaStateSummary states={personas} />
        <LiveMetricChart events={stream.events} />
      </div>
      <DebateStageTracker stages={debate} />
    </section>
  );
}
