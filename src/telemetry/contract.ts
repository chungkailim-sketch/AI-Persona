/**
 * The telemetry event contract.
 *
 * One shape for everything the live interface shows: ingestion, persona generation and runs, from
 * the real pipeline and from the test fixture provider alike. It is imported by the server (which
 * writes and streams events) and by the browser (which validates what it receives), so this module
 * must stay free of server-only imports.
 *
 * What an event may carry is deliberately narrow. It describes that something happened, in which
 * stage, with what outcome and what count. It never carries a source value, a prompt, a model's
 * rationale, a respondent's answer or a stack trace — `safeMetadata` is allow-listed and
 * length-capped by `sanitizeMetadata()` before anything is written.
 */
import { z } from 'zod';

export const EVENT_STATUSES = [
  'pending',
  'active',
  'completed',
  'warning',
  'failed',
  'cancelled',
  'retryable',
  'skipped',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const SEVERITIES = ['info', 'notice', 'warning', 'error'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SOURCE_TYPES = ['dataset', 'cohort', 'run', 'job'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Keys that may appear in `safeMetadata`. Anything else is dropped before the event is written. */
export const SAFE_METADATA_KEYS = [
  'fileName',
  'fileCount',
  'sheetName',
  'sheetCount',
  'rowCount',
  'fieldCount',
  'count',
  'fieldName',
  'check',
  'personaKey',
  'personaCount',
  'segment',
  'stepIndex',
  'stepTotal',
  'observation',
  'action',
  'evaluation',
  'verdict',
  'score',
  'attempt',
  'outcome',
  'inputTokens',
  'outputTokens',
  'costUsd',
  'latencyMs',
  'confidence',
  'stance',
  'majorityStance',
  'challengers',
  'required',
  'evidenceCount',
  'flipRate',
  'entropy',
  'capitulationRate',
  'herdingSuspected',
  'classification',
  'consensusRatio',
  'qualityScore',
  'blocking',
  'warnings',
  'jobKind',
  'reason',
  'fixture',
] as const;
export type SafeMetadataKey = (typeof SAFE_METADATA_KEYS)[number];

const metadataValue = z.union([z.string().max(240), z.number(), z.boolean(), z.null()]);

export const TelemetryEventSchema = z.object({
  /** Globally unique; the idempotency key for the browser's de-duplication. */
  eventId: z.string().min(1),
  /** Server-assigned, strictly increasing. The ordering and the resume cursor (`Last-Event-ID`). */
  seq: z.number().int().nonnegative(),
  eventType: z.string().min(1).max(80),
  sourceType: z.enum(SOURCE_TYPES),
  sourceId: z.string().min(1),
  projectId: z.string().min(1),
  /** The dataset *version* the event concerns. Versions, not datasets, are what get ingested. */
  datasetVersionId: z.string().nullable(),
  cohortId: z.string().nullable(),
  runId: z.string().nullable(),
  stage: z.string().min(1).max(60),
  status: z.enum(EVENT_STATUSES),
  message: z.string().max(500),
  progressCurrent: z.number().int().nullable(),
  progressTotal: z.number().int().nullable(),
  metricName: z.string().nullable(),
  metricValue: z.number().nullable(),
  severity: z.enum(SEVERITIES),
  timestamp: z.string().datetime(),
  retryable: z.boolean(),
  correlationId: z.string().nullable(),
  /** True when the event came from the mock model provider or a test fixture. */
  isMock: z.boolean(),
  safeMetadata: z.record(metadataValue).nullable(),
});
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

/** The server's view of a stream's subject, sent on connect and on every reconnection. */
export const StreamSnapshotSchema = z.object({
  kind: z.literal('snapshot'),
  cursor: z.number().int().nonnegative(),
  run: z
    .object({
      id: z.string(),
      status: z.string(),
      isMock: z.boolean(),
      startedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
      cancelRequested: z.boolean(),
      failureReason: z.string().nullable(),
      calls: z.number().int(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      costUsd: z.number(),
      steps: z.array(z.object({ stage: z.string(), status: z.string(), durationMs: z.number().nullable() })),
    })
    .nullable(),
  dataset: z
    .object({
      versionId: z.string(),
      status: z.string(),
      rowCount: z.number().int().nullable(),
      qualityScore: z.number().int().nullable(),
    })
    .nullable(),
  serverTime: z.string(),
});
export type StreamSnapshot = z.infer<typeof StreamSnapshotSchema>;

// ── Stage catalogues ──────────────────────────────────────────────────────────

/**
 * The fifteen ingestion stages, in order. (Malware scanning is recorded against each file but not shown
 * as a stage: no scanner is part of this deployment, so a permanent "not performed" node told nobody anything.) Each is emitted by `runIngest()` (or the upload and
 * governance paths) at the moment the underlying work actually happens.
 */
export const INGEST_STAGES = [
  { key: 'upload_received', label: 'Upload received', description: 'Files stored under generated keys' },
  { key: 'file_identification', label: 'File identification', description: 'Format recognised from the file' },
  { key: 'parsing', label: 'Parsing', description: 'Sheets and rows read' },
  { key: 'data_structuring', label: 'Data structuring', description: 'Report layouts flattened into typed, loadable tables' },
  { key: 'schema_detection', label: 'Schema detection', description: 'Header rows and field types inferred' },
  { key: 'field_mapping', label: 'Field mapping', description: 'Fields recorded against the version' },
  { key: 'data_profiling', label: 'Data profiling', description: 'Distinct values and distributions' },
  { key: 'duplicate_detection', label: 'Duplicate detection', description: 'Repeated rows' },
  { key: 'missing_values', label: 'Missing-value analysis', description: 'Blank and "no data" markers' },
  { key: 'outlier_analysis', label: 'Outlier analysis', description: "Tukey's fence, MAD fallback" },
  { key: 'sensitive_detection', label: 'Sensitive-data detection', description: 'By field name and value shape' },
  { key: 'quality_assessment', label: 'Data-quality assessment', description: 'Five weighted components' },
  { key: 'evidence_preparation', label: 'Evidence preparation', description: 'Field summaries a finding can cite' },
  { key: 'ready_for_review', label: 'Ready for review', description: 'Waiting for a person' },
  { key: 'import_approved', label: 'Import approved', description: 'Provenance recorded and use permitted' },
] as const;
export type IngestStageKey = (typeof INGEST_STAGES)[number]['key'];

/** The condensed flow drawn by the data-flow visualisation, each node owning a run of stages. */
export const DATA_FLOW_NODES: readonly { key: string; label: string; stages: readonly IngestStageKey[] }[] = [
  { key: 'source', label: 'Source file', stages: ['upload_received'] },
  { key: 'validation', label: 'Validation', stages: ['file_identification'] },
  { key: 'parsing', label: 'Parsing', stages: ['parsing', 'data_structuring', 'schema_detection', 'field_mapping'] },
  {
    key: 'profiling',
    label: 'Profiling',
    stages: ['data_profiling', 'duplicate_detection', 'missing_values', 'outlier_analysis'],
  },
  { key: 'sensitive', label: 'Sensitive-data review', stages: ['sensitive_detection'] },
  { key: 'evidence', label: 'Evidence preparation', stages: ['quality_assessment', 'evidence_preparation'] },
  { key: 'ready', label: 'Dataset ready', stages: ['ready_for_review', 'import_approved'] },
];

/** Mirrors `RUN_STAGES` in the orchestrator; a test asserts the two never drift apart. */
export const RUN_STAGE_CATALOGUE = [
  { key: 'PREPARING_CONTEXT', label: 'Preparing context', description: 'Evidence assembled behind the governance gate' },
  { key: 'GENERATING_PERSONAS', label: 'Binding personas', description: 'Approved cohort attached to the run' },
  { key: 'INDEPENDENT_ASSESSMENT', label: 'Independent assessment', description: 'Each persona answers alone' },
  { key: 'CONSUMER_REACTION', label: 'Consumer reaction', description: 'Reactions to the stimulus, in isolation' },
  { key: 'CROSS_EXAMINATION', label: 'Cross-examination', description: 'At least half the panel challenges the majority' },
  { key: 'REVISION', label: 'Revision', description: 'Each persona reconsiders' },
  { key: 'SYNTHESIS', label: 'Synthesis', description: 'Findings, dissent and anti-herding metrics' },
  { key: 'REPORT', label: 'Report', description: 'Persisted for reading and export' },
] as const;
export type RunStageKey = (typeof RUN_STAGE_CATALOGUE)[number]['key'];

/**
 * The nine-stage debate method (PRD §16.2), each mapped to the orchestrator stage in which it is
 * actually carried out. Where two method stages happen inside one orchestrator stage, the tracker
 * says so rather than pretending they are separate steps.
 */
export const DEBATE_STAGES: readonly {
  key: string;
  label: string;
  runStage: RunStageKey;
  performedWithin?: string;
  roles: string;
}[] = [
  { key: 'independent_assessment', label: 'Independent assessment', runStage: 'INDEPENDENT_ASSESSMENT', roles: 'Consumer personas, in isolation' },
  { key: 'evidence_citation', label: 'Evidence citation', runStage: 'INDEPENDENT_ASSESSMENT', performedWithin: 'Independent assessment — each answer cites its evidence', roles: 'Consumer personas' },
  { key: 'consumer_response', label: 'Consumer response', runStage: 'CONSUMER_REACTION', roles: 'Consumer personas, in isolation' },
  { key: 'cross_examination', label: 'Cross-examination', runStage: 'CROSS_EXAMINATION', roles: 'Challengers drawn from the majority' },
  { key: 'disagreement_identification', label: 'Disagreement identification', runStage: 'CROSS_EXAMINATION', performedWithin: 'Cross-examination — the majority is computed before challenges', roles: 'Orchestrator (arithmetic, no model)' },
  { key: 'position_revision', label: 'Position revision', runStage: 'REVISION', roles: 'Consumer personas' },
  { key: 'moderator_synthesis', label: 'Moderator synthesis', runStage: 'SYNTHESIS', roles: 'Orchestrator (arithmetic, no model)' },
  { key: 'confidence_calibration', label: 'Confidence calibration', runStage: 'SYNTHESIS', performedWithin: 'Synthesis — anti-herding metrics', roles: 'Orchestrator (arithmetic, no model)' },
  { key: 'final_recommendation', label: 'Final recommendation', runStage: 'REPORT', roles: 'Orchestrator (fixed wording)' },
];

/** Persona generation checkpoints, in the order `createCohort()` passes them. */
export const PERSONA_STAGES = [
  { key: 'evidence', label: 'Evidence loaded' },
  { key: 'segmentation', label: 'Segment definition' },
  { key: 'generation', label: 'Candidates generated' },
  { key: 'grounding', label: 'Evidence grounding' },
  { key: 'normalization', label: 'Cohort normalised' },
  { key: 'approval', label: 'Approval' },
] as const;

export const TERMINAL_RUN_STATUSES = ['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CANCELLED'] as const;

export function isTerminalRunStatus(status: string | null | undefined): boolean {
  return Boolean(status) && (TERMINAL_RUN_STATUSES as readonly string[]).includes(status!);
}

/** Whether the subject is still changing — used to end a stream that has nothing more to say. */
export function isSettled(snapshot: StreamSnapshot): boolean {
  if (snapshot.run) {
    return ['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED', 'CANCELLED', 'DRAFT'].includes(snapshot.run.status);
  }
  if (snapshot.dataset) {
    return ['READY_FOR_REVIEW', 'IMPORTED', 'PARTIALLY_IMPORTED', 'FAILED'].includes(snapshot.dataset.status);
  }
  return false;
}

// ── Sanitising ────────────────────────────────────────────────────────────────

/**
 * Reduce arbitrary metadata to the allow-listed, length-capped shape the contract accepts.
 * Unknown keys are dropped, strings are truncated, objects and arrays are refused outright.
 */
export function sanitizeMetadata(input: Record<string, unknown> | null | undefined): Record<string, string | number | boolean | null> | null {
  if (!input) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const key of SAFE_METADATA_KEYS) {
    if (!(key in input)) continue;
    const v = input[key];
    if (v === null) out[key] = null;
    else if (typeof v === 'string') out[key] = v.length > 240 ? `${v.slice(0, 239)}…` : v;
    else if (typeof v === 'number') out[key] = Number.isFinite(v) ? v : null;
    else if (typeof v === 'boolean') out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ── Normalising ───────────────────────────────────────────────────────────────

/**
 * Merge incoming events into an existing list.
 *
 * Idempotent (an event seen twice is kept once), order-safe (the result is always sorted by the
 * server's sequence, whatever order the network delivered it in) and bounded (only the newest
 * `limit` events are retained in the browser; older ones remain on the server).
 */
export function mergeEvents(existing: readonly TelemetryEvent[], incoming: readonly TelemetryEvent[], limit = 1000): TelemetryEvent[] {
  if (incoming.length === 0) return existing as TelemetryEvent[];
  const seen = new Set(existing.map((e) => e.eventId));
  const fresh = incoming.filter((e) => {
    if (seen.has(e.eventId)) return false;
    seen.add(e.eventId);
    return true;
  });
  if (fresh.length === 0) return existing as TelemetryEvent[];

  const last = existing[existing.length - 1];
  const inOrder = fresh.every((e, i) => e.seq > (i === 0 ? (last?.seq ?? -1) : fresh[i - 1]!.seq));
  const merged = inOrder ? [...existing, ...fresh] : [...existing, ...fresh].sort((a, b) => a.seq - b.seq);
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

/** Parse untrusted input (a stream message) into events, dropping anything that fails the contract. */
export function parseEvents(raw: unknown): TelemetryEvent[] {
  const list = Array.isArray(raw) ? raw : [raw];
  const out: TelemetryEvent[] = [];
  for (const item of list) {
    const parsed = TelemetryEventSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
