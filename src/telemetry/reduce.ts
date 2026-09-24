/**
 * Pure reducers from events (and, where the server has it, an authoritative snapshot) to the state
 * the live interface draws. No clock drives any of this: a stage advances only because an event
 * says it did. `now` is used for one thing — the trailing throughput window — and never to move a
 * stage or a progress figure.
 */
import {
  DATA_FLOW_NODES,
  DEBATE_STAGES,
  INGEST_STAGES,
  RUN_STAGE_CATALOGUE,
  isTerminalRunStatus,
  type IngestStageKey,
  type RunStageKey,
  type StreamSnapshot,
  type TelemetryEvent,
} from './contract';

export type NodeStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'warning'
  | 'failed'
  | 'cancelled'
  | 'retryable'
  | 'not_performed'
  /** Nothing is running: the next step belongs to a person. Never animated. */
  | 'awaiting';

export interface NodeState {
  status: NodeStatus;
  message: string | null;
  count: number | null;
  warnings: number;
  updatedAt: string | null;
}

const blank = (): NodeState => ({ status: 'pending', message: null, count: null, warnings: 0, updatedAt: null });

/**
 * Fold one event into a node.
 *
 * Precedence matters more than recency: a stage that finished with a warning stays "warning" when a
 * later informational event for it arrives, and a failure is only superseded by the stage being
 * started again (a retry).
 */
export function applyToNode(node: NodeState, e: TelemetryEvent): NodeState {
  const next: NodeState = { ...node, updatedAt: e.timestamp, message: e.message };
  if (e.progressCurrent !== null) next.count = e.progressCurrent;
  switch (e.status) {
    case 'pending':
      next.status = node.status === 'completed' || node.status === 'warning' ? node.status : 'awaiting';
      break;
    case 'active':
      if (node.status === 'failed' || node.status === 'retryable') {
        // Started again after a failure: that is a retry, and the node is live again.
        next.status = 'active';
      } else if (node.status === 'pending' || node.status === 'active' || node.status === 'awaiting') {
        next.status = 'active';
      } else {
        next.status = node.status; // informational event after completion
      }
      break;
    case 'completed':
      next.status = node.status === 'warning' ? 'warning' : 'completed';
      break;
    case 'warning':
      next.status = 'warning';
      next.warnings = node.warnings + 1;
      break;
    case 'failed':
      next.status = e.retryable ? 'retryable' : 'failed';
      break;
    case 'retryable':
      next.status = 'retryable';
      break;
    case 'cancelled':
      next.status = 'cancelled';
      break;
    case 'skipped':
      next.status = 'not_performed';
      break;
  }
  return next;
}

export interface PipelineState {
  stages: Record<IngestStageKey, NodeState>;
  /** Where the state came from. `status` means per-stage events were never recorded. */
  source: 'events' | 'status' | 'empty';
  active: IngestStageKey | null;
  failed: IngestStageKey | null;
  completedCount: number;
}

export function reducePipeline(events: readonly TelemetryEvent[]): PipelineState {
  const stages = Object.fromEntries(INGEST_STAGES.map((s) => [s.key, blank()])) as Record<IngestStageKey, NodeState>;
  let any = false;
  for (const e of events) {
    if (e.sourceType !== 'dataset') continue;
    if (!(e.stage in stages)) continue;
    any = true;
    const key = e.stage as IngestStageKey;
    stages[key] = applyToNode(stages[key], e);
  }
  return finishPipeline(stages, any ? 'events' : 'empty');
}

function finishPipeline(stages: Record<IngestStageKey, NodeState>, source: PipelineState['source']): PipelineState {
  let active: IngestStageKey | null = null;
  let failed: IngestStageKey | null = null;
  let completedCount = 0;
  for (const s of INGEST_STAGES) {
    const st = stages[s.key].status;
    if (st === 'active' && !active) active = s.key;
    if ((st === 'failed' || st === 'retryable') && !failed) failed = s.key;
    if (st === 'completed' || st === 'warning' || st === 'not_performed') completedCount += 1;
  }
  return { stages, source, active, failed, completedCount };
}

const STATUS_REACHED: Record<string, number> = {
  AWAITING_UPLOAD: 0,
  UPLOADING: 1,
  SCANNING: 1,
  PARSING: 3,
  PROFILING: 6,
  MAPPING: 5,
  VALIDATING: 7,
  DETECTING_SENSITIVE: 10,
  READY_FOR_REVIEW: 14,
  PARTIALLY_IMPORTED: 14,
  IMPORTED: 14,
};

/**
 * For a version ingested before per-stage events existed: reconstruct what the recorded status
 * proves, and nothing more. Stages the status implies are marked complete; the message says the
 * detail was not recorded, so nobody reads a reconstruction as a trace.
 */
export function pipelineFromVersionStatus(status: string, opts: { approved: boolean; scanned: boolean }): PipelineState {
  const stages = Object.fromEntries(INGEST_STAGES.map((s) => [s.key, blank()])) as Record<IngestStageKey, NodeState>;
  if (status === 'FAILED') {
    stages.upload_received = { ...blank(), status: 'completed' };
    stages.parsing = { ...blank(), status: 'failed', message: 'Ingestion failed. See the findings and file errors below.' };
    return finishPipeline(stages, 'status');
  }
  const reached = STATUS_REACHED[status] ?? 0;
  INGEST_STAGES.forEach((s, i) => {
    // The banner above the pipeline states that these are reconstructed; repeating it on every
    // node would bury the one node that says something different.
    if (i < reached) stages[s.key] = { ...blank(), status: 'completed' };
    else if (i === reached && reached > 0 && reached < 14) stages[s.key] = { ...blank(), status: 'active' };
  });
  if (reached > 1 && !opts.scanned) {
    stages.safety_scan = { ...blank(), status: 'not_performed', message: 'No malware scanner is configured; files are recorded as NOT_SCANNED.' };
  }
  if (reached >= 14) {
    stages.ready_for_review = { ...blank(), status: 'completed' };
    stages.import_approved = opts.approved
      ? { ...blank(), status: 'completed', message: 'All four conditions for use are met.' }
      : { ...blank(), status: 'awaiting', message: 'Waiting for a person to review fields, record provenance and permit use.' };
  }
  return finishPipeline(stages, 'status');
}

export interface FlowNodeState {
  key: string;
  label: string;
  status: NodeStatus;
}

/** Collapse the fifteen stages into the seven-node flow. A node is only as far along as its least-advanced stage. */
export function reduceFlow(pipeline: PipelineState): FlowNodeState[] {
  return DATA_FLOW_NODES.map((node) => {
    const states = node.stages.map((k) => pipeline.stages[k].status);
    let status: NodeStatus;
    if (states.some((s) => s === 'failed')) status = 'failed';
    else if (states.some((s) => s === 'retryable')) status = 'retryable';
    else if (states.some((s) => s === 'cancelled')) status = 'cancelled';
    else if (states.some((s) => s === 'active')) status = 'active';
    else if (states.some((s) => s === 'awaiting')) status = 'awaiting';
    else if (states.every((s) => s === 'pending')) status = 'pending';
    else if (states.some((s) => s === 'pending')) status = 'active';
    else if (states.some((s) => s === 'warning' || s === 'not_performed')) status = 'warning';
    else status = 'completed';
    return { key: node.key, label: node.label, status };
  });
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export type RunStageStates = Record<RunStageKey, NodeState>;

const STEP_STATUS: Record<string, NodeStatus> = {
  pending: 'pending',
  running: 'active',
  completed: 'completed',
  failed: 'failed',
  skipped: 'not_performed',
};

/**
 * Stage states for a run. The snapshot's `RunStep` rows are authoritative and win over events,
 * which is what makes a reconnection converge on the truth even if events were missed.
 */
export function reduceRunStages(events: readonly TelemetryEvent[], snapshot: StreamSnapshot['run'] | null): RunStageStates {
  const stages = Object.fromEntries(RUN_STAGE_CATALOGUE.map((s) => [s.key, blank()])) as RunStageStates;
  for (const e of events) {
    if (e.sourceType !== 'run' || !(e.stage in stages)) continue;
    const key = e.stage as RunStageKey;
    if (e.eventType === 'run.call.completed') {
      stages[key] = { ...stages[key], count: e.progressCurrent ?? stages[key].count, updatedAt: e.timestamp };
      if (e.safeMetadata?.verdict === 'fail' || e.safeMetadata?.verdict === 'flag') {
        stages[key].warnings += 1;
      }
      continue;
    }
    if (e.eventType === 'run.call.started') continue;
    stages[key] = applyToNode(stages[key], e);
  }
  if (snapshot) {
    for (const step of snapshot.steps) {
      if (!(step.stage in stages)) continue;
      const key = step.stage as RunStageKey;
      const status = STEP_STATUS[step.status] ?? stages[key].status;
      // Keep a warning the events recorded if the step itself merely says "completed".
      stages[key].status = status === 'completed' && stages[key].status === 'warning' ? 'warning' : status;
    }
    if (snapshot.status === 'CANCELLED') {
      for (const s of RUN_STAGE_CATALOGUE) if (stages[s.key].status === 'active') stages[s.key].status = 'cancelled';
    }
  }
  return stages;
}

export interface DebateStageState {
  key: string;
  label: string;
  status: NodeStatus;
  performedWithin: string | null;
  roles: string;
  completedTasks: number;
  warnings: number;
  participants: number;
  preliminaryOutput: string | null;
}

export function reduceDebateStages(runStages: RunStageStates, events: readonly TelemetryEvent[]): DebateStageState[] {
  const participants = new Map<string, Set<string>>();
  const completed = new Map<string, number>();
  let majority: string | null = null;
  let antiHerd: string | null = null;
  let evidenceCited = 0;
  for (const e of events) {
    if (e.sourceType !== 'run') continue;
    const persona = typeof e.safeMetadata?.personaKey === 'string' ? e.safeMetadata.personaKey : null;
    if (e.eventType === 'run.call.completed') {
      if (persona) {
        const set = participants.get(e.stage) ?? new Set<string>();
        set.add(persona);
        participants.set(e.stage, set);
      }
      completed.set(e.stage, (completed.get(e.stage) ?? 0) + 1);
      if (e.stage === 'INDEPENDENT_ASSESSMENT' && typeof e.safeMetadata?.evidenceCount === 'number' && e.safeMetadata.evidenceCount > 0) {
        evidenceCited += 1;
      }
    }
    if (e.eventType === 'run.disagreement' && typeof e.safeMetadata?.majorityStance === 'string') {
      majority = `Majority independent stance: ${e.safeMetadata.majorityStance}; ${e.safeMetadata.challengers ?? 0} challengers required.`;
    }
    if (e.eventType === 'run.antiherd') antiHerd = e.message;
  }

  return DEBATE_STAGES.map((d) => {
    const base = runStages[d.runStage];
    let tasks = completed.get(d.runStage) ?? 0;
    let preliminary: string | null = null;
    if (d.key === 'evidence_citation') {
      tasks = evidenceCited;
      preliminary = tasks > 0 ? `${evidenceCited} answer(s) cited evidence so far.` : null;
    }
    if (d.key === 'disagreement_identification') {
      tasks = majority ? 1 : 0;
      preliminary = majority;
    }
    if (d.key === 'confidence_calibration') {
      tasks = antiHerd ? 1 : 0;
      preliminary = antiHerd;
    }
    if (d.key === 'moderator_synthesis' || d.key === 'final_recommendation') {
      tasks = base.status === 'completed' ? 1 : 0;
    }
    return {
      key: d.key,
      label: d.label,
      status: base.status,
      performedWithin: d.performedWithin ?? null,
      roles: d.roles,
      completedTasks: tasks,
      warnings: base.warnings,
      participants: participants.get(d.runStage)?.size ?? 0,
      preliminaryOutput: preliminary,
    };
  });
}

export type Verdict = 'pass' | 'flag' | 'fail';

export interface RunMetrics {
  callsCompleted: number;
  pass: number;
  flag: number;
  fail: number;
  passRate: number | null;
  flagRate: number | null;
  failRate: number | null;
  /** Completed calls in the trailing 60 seconds. Null when the run is not active. */
  callsPerMinute: number | null;
  /** Mean stated confidence across completed calls that reported one. Not a quality score. */
  meanConfidence: number | null;
  retries: number;
  warnings: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  currentStage: RunStageKey | null;
  stageProgress: { current: number; total: number } | null;
  lastUpdated: string | null;
}

export function aggregateRunMetrics(
  events: readonly TelemetryEvent[],
  snapshot: StreamSnapshot['run'] | null,
  now: number,
): RunMetrics {
  let pass = 0;
  let flag = 0;
  let fail = 0;
  let retries = 0;
  let warnings = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let confSum = 0;
  let confN = 0;
  let recent = 0;
  let currentStage: RunStageKey | null = null;
  let stageProgress: RunMetrics['stageProgress'] = null;
  let lastUpdated: string | null = null;

  for (const e of events) {
    if (e.sourceType !== 'run') continue;
    lastUpdated = e.timestamp;
    if (e.eventType === 'run.stage' && e.status === 'active') {
      currentStage = e.stage as RunStageKey;
      stageProgress = e.progressTotal ? { current: 0, total: e.progressTotal } : null;
    }
    if (e.severity === 'warning' || e.status === 'warning') warnings += 1;
    if (e.eventType !== 'run.call.completed') continue;
    const m = e.safeMetadata ?? {};
    const verdict = m.verdict;
    if (verdict === 'pass') pass += 1;
    else if (verdict === 'flag') flag += 1;
    else if (verdict === 'fail') fail += 1;
    if (typeof m.attempt === 'number' && m.attempt > 1) retries += m.attempt - 1;
    if (typeof m.inputTokens === 'number') inputTokens += m.inputTokens;
    if (typeof m.outputTokens === 'number') outputTokens += m.outputTokens;
    if (typeof m.costUsd === 'number') costUsd += m.costUsd;
    if (typeof m.confidence === 'number') {
      confSum += m.confidence;
      confN += 1;
    }
    if (now - Date.parse(e.timestamp) <= 60_000) recent += 1;
    if (stageProgress && e.stage === currentStage && e.progressCurrent !== null) {
      stageProgress = { current: e.progressCurrent, total: e.progressTotal ?? stageProgress.total };
    }
  }

  // The snapshot is summed from ModelCall rows, so it wins for accounting whenever it is present.
  if (snapshot) {
    inputTokens = Math.max(inputTokens, snapshot.inputTokens);
    outputTokens = Math.max(outputTokens, snapshot.outputTokens);
    costUsd = Math.max(costUsd, snapshot.costUsd);
  }

  const total = pass + flag + fail;
  const active = snapshot ? !isTerminalRunStatus(snapshot.status) && snapshot.status !== 'DRAFT' : currentStage !== null;
  return {
    callsCompleted: total,
    pass,
    flag,
    fail,
    passRate: total ? pass / total : null,
    flagRate: total ? flag / total : null,
    failRate: total ? fail / total : null,
    callsPerMinute: active ? recent : null,
    meanConfidence: confN ? confSum / confN : null,
    retries,
    warnings,
    inputTokens,
    outputTokens,
    costUsd,
    currentStage: active ? currentStage : null,
    stageProgress: active ? stageProgress : null,
    lastUpdated,
  };
}

export type PersonaActivity =
  | 'waiting'
  | 'evaluating'
  | 'responding'
  | 'challenging'
  | 'revising'
  | 'scored'
  | 'completed'
  | 'retrying'
  | 'failed';

export const PERSONA_ACTIVITY_ORDER: readonly PersonaActivity[] = [
  'waiting',
  'evaluating',
  'responding',
  'challenging',
  'revising',
  'retrying',
  'scored',
  'completed',
  'failed',
];

const STAGE_VERB: Partial<Record<string, PersonaActivity>> = {
  INDEPENDENT_ASSESSMENT: 'evaluating',
  CONSUMER_REACTION: 'responding',
  CROSS_EXAMINATION: 'challenging',
  REVISION: 'revising',
};

/** Where each persona is, derived only from the events that mention it. */
export function reducePersonaActivity(
  events: readonly TelemetryEvent[],
  personaKeys: readonly string[],
  runStatus: string | null,
): Map<string, PersonaActivity> {
  const state = new Map<string, PersonaActivity>(personaKeys.map((k) => [k, 'waiting']));
  for (const e of events) {
    if (e.sourceType !== 'run') continue;
    if (e.eventType === 'run.stage' && e.status === 'active') {
      // Everyone not yet picked up in the new stage is waiting for it.
      for (const k of state.keys()) if (state.get(k) !== 'failed') state.set(k, 'waiting');
    }
    const key = typeof e.safeMetadata?.personaKey === 'string' ? e.safeMetadata.personaKey : null;
    if (!key) continue;
    if (!state.has(key)) state.set(key, 'waiting');
    if (e.eventType === 'run.call.started') {
      const attempt = typeof e.safeMetadata?.attempt === 'number' ? e.safeMetadata.attempt : 1;
      state.set(key, attempt > 1 ? 'retrying' : (STAGE_VERB[e.stage] ?? 'evaluating'));
    } else if (e.eventType === 'run.call.completed') {
      if (e.safeMetadata?.verdict === 'fail') {
        state.set(key, 'failed');
      } else {
        state.set(key, 'scored');
      }
    }
  }
  if (runStatus === 'COMPLETED' || runStatus === 'COMPLETED_WITH_WARNINGS') {
    for (const k of state.keys()) if (state.get(k) !== 'failed') state.set(k, 'completed');
  }
  return state;
}

export interface PreliminaryTally {
  processed: number;
  total: number | null;
  confirm: number;
  dispute: number;
  abstain: number;
  /** True once the report stage has completed — preliminary figures must then give way to the report. */
  superseded: boolean;
}

/** The independent-round tally, as far as it has got. Always presented as preliminary. */
export function preliminaryTally(events: readonly TelemetryEvent[]): PreliminaryTally | null {
  let confirm = 0;
  let dispute = 0;
  let abstain = 0;
  let total: number | null = null;
  let superseded = false;
  let any = false;
  for (const e of events) {
    if (e.sourceType !== 'run') continue;
    if (e.stage === 'REPORT' && e.eventType === 'run.stage' && e.status === 'completed') superseded = true;
    if (e.stage !== 'INDEPENDENT_ASSESSMENT' || e.eventType !== 'run.call.completed') continue;
    any = true;
    total = e.progressTotal ?? total;
    const s = e.safeMetadata?.stance;
    if (s === 'confirm') confirm += 1;
    else if (s === 'dispute') dispute += 1;
    else if (s === 'abstain') abstain += 1;
  }
  if (!any) return null;
  return { processed: confirm + dispute + abstain, total, confirm, dispute, abstain, superseded };
}

/**
 * The one sentence worth announcing to a screen reader when state changes. Returns null when the
 * change is not meaningful — individual events are never announced.
 */
export function announcementFor(
  prev: { stage: string | null; status: string | null },
  next: { stage: string | null; status: string | null; stageLabel?: string },
): string | null {
  if (next.status && next.status !== prev.status) {
    if (next.status === 'FAILED') return 'The run failed.';
    if (next.status === 'CANCELLED') return 'The run was cancelled.';
    if (next.status === 'COMPLETED') return 'The run completed. Final results are available.';
    if (next.status === 'COMPLETED_WITH_WARNINGS') return 'The run completed with warnings. Final results are available.';
  }
  if (next.stage && next.stage !== prev.stage) return `Now in stage: ${next.stageLabel ?? next.stage}.`;
  return null;
}

/**
 * The run's status as the events describe it, reconciled with the snapshot. The snapshot is read
 * every few seconds; terminal events arrive at once. A terminal snapshot always wins; otherwise a
 * terminal event does; otherwise the stage currently active; otherwise the snapshot as it stands.
 */
export function effectiveRunStatus(events: readonly TelemetryEvent[], snapshotStatus: string | null): string {
  if (snapshotStatus && isTerminalRunStatus(snapshotStatus)) return snapshotStatus;
  let status = snapshotStatus ?? 'QUEUED';
  for (const e of events) {
    if (e.sourceType !== 'run') continue;
    if (e.eventType === 'run.completed') status = e.status === 'warning' ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED';
    else if (e.eventType === 'run.failed') status = 'FAILED';
    else if (e.eventType === 'run.cancelled') status = 'CANCELLED';
    else if (e.eventType === 'run.stage' && e.status === 'active' && !isTerminalRunStatus(status)) status = e.stage;
  }
  return status;
}
