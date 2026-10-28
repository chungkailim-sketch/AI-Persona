/**
 * The five-step journey's state (data → brief → cast → roundtable → report), computed from the
 * tables of record on every render.
 *
 * Each step reports one status, a count of unresolved items and when it was last saved. A blocked
 * step always carries its reason (FR-83), and every step stays reachable — a blocked step explains
 * itself on arrival rather than being a dead control.
 */
import { prisma } from '@/lib/prisma';
import { assessUsability } from '@/ingest/pipeline';
import { studyBriefMissing } from '@/roundtable/service';
import type { StepKey } from '@/ui/shell/steps';

export type WorkflowStatus = 'complete' | 'running' | 'warning' | 'error' | 'blocked' | 'available';

export interface WorkflowStepState {
  status: WorkflowStatus;
  reason: string | null;
  unresolved: number;
  lastSavedAt: string | null;
}

export type WorkflowState = Record<StepKey, WorkflowStepState>;

const INGESTING = ['UPLOADING', 'SCANNING', 'PARSING', 'PROFILING', 'MAPPING', 'VALIDATING', 'DETECTING_SENSITIVE'];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const latest = (...ds: (Date | null | undefined)[]) =>
  ds.filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

export async function computeWorkflowState(projectId: string): Promise<WorkflowState> {
  const [links, brief, cast, roundtable] = await Promise.all([
    prisma.projectDataset.findMany({
      where: { projectId, dataset: { deletedAt: null } },
      include: { dataset: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, include: { governance: true } } } } },
    }),
    prisma.brief.findFirst({ where: { projectId }, orderBy: { versionNo: 'desc' }, select: { updatedAt: true, markets: true, researchQuestion: true, categories: true } }),
    prisma.cohort.findFirst({
      where: { projectId, kind: 'cast' },
      orderBy: { generatedAt: 'desc' },
      select: { generatedAt: true, buildStatus: true, buildError: true, personas: { select: { versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { approval: true } } } } },
    }),
    prisma.roundtable.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, createdAt: true, completedAt: true, failureReason: true, total: true, _count: { select: { answers: true } } },
    }),
  ]);

  // ── 1. Data ──
  const versions = links.map((l) => l.dataset.versions[0]).filter((v): v is NonNullable<typeof v> => Boolean(v));
  const verdicts = await Promise.all(versions.map((v) => assessUsability(v.id)));
  const usable = verdicts.filter((v) => v.usable).length;
  const failed = versions.filter((v) => v.status === 'FAILED').length;
  const dataSaved = latest(...versions.map((v) => v.createdAt), ...versions.map((v) => v.governance?.confirmedAt));
  let data: WorkflowStepState;
  if (versions.some((v) => INGESTING.includes(v.status))) {
    data = { status: 'running', reason: 'Importing files.', unresolved: failed, lastSavedAt: iso(dataSaved) };
  } else if (versions.length > 0 && usable === 0 && failed === versions.length) {
    data = { status: 'error', reason: 'Every file failed to import.', unresolved: failed, lastSavedAt: iso(dataSaved) };
  } else if (usable > 0) {
    data = { status: 'complete', reason: null, unresolved: failed, lastSavedAt: iso(dataSaved) };
  } else if (versions.length > 0) {
    data = { status: 'warning', reason: 'No file is ready yet.', unresolved: versions.length, lastSavedAt: iso(dataSaved) };
  } else {
    data = { status: 'available', reason: 'Nothing uploaded yet.', unresolved: 0, lastSavedAt: null };
  }

  // ── 2. Brief ──
  const missing = studyBriefMissing(brief);
  const briefState: WorkflowStepState = !brief
    ? { status: 'available', reason: 'Not started.', unresolved: 0, lastSavedAt: null }
    : missing.length === 0
      ? { status: 'complete', reason: null, unresolved: 0, lastSavedAt: iso(brief.updatedAt) }
      : { status: 'warning', reason: missing[0] ?? 'Incomplete.', unresolved: missing.length, lastSavedAt: iso(brief.updatedAt) };

  // ── 3. Cast ──
  const pending = cast ? cast.personas.filter((p) => p.versions[0]?.approval !== 'APPROVED').length : 0;
  let castState: WorkflowStepState;
  if (!cast) {
    const needs = [usable === 0 && 'data that is ready', missing.length > 0 && 'a complete brief'].filter(Boolean) as string[];
    castState = needs.length
      ? { status: 'blocked', reason: `Needs ${needs.join(' and ')}.`, unresolved: 0, lastSavedAt: null }
      : { status: 'available', reason: 'No cast built yet.', unresolved: 0, lastSavedAt: null };
  } else if (cast.buildStatus === 'QUEUED' || cast.buildStatus === 'RUNNING') {
    castState = { status: 'running', reason: 'Building the cast.', unresolved: 0, lastSavedAt: iso(cast.generatedAt) };
  } else if (cast.buildStatus === 'FAILED') {
    castState = { status: 'error', reason: cast.buildError ?? 'The cast could not be built.', unresolved: 1, lastSavedAt: iso(cast.generatedAt) };
  } else if (pending > 0) {
    castState = { status: 'warning', reason: 'Review and approve the cast.', unresolved: 0, lastSavedAt: iso(cast.generatedAt) };
  } else {
    castState = { status: 'complete', reason: null, unresolved: 0, lastSavedAt: iso(cast.generatedAt) };
  }

  // ── 4. Roundtable ──
  let rtState: WorkflowStepState;
  if (roundtable?.status === 'QUEUED' || roundtable?.status === 'RUNNING') {
    rtState = { status: 'running', reason: `${roundtable._count.answers} of ${roundtable.total} personas have answered.`, unresolved: 0, lastSavedAt: iso(roundtable.createdAt) };
  } else if (roundtable?.status === 'FAILED') {
    rtState = { status: 'error', reason: roundtable.failureReason ?? 'The roundtable stopped.', unresolved: 1, lastSavedAt: iso(roundtable.completedAt ?? roundtable.createdAt) };
  } else if (roundtable?.status === 'COMPLETED') {
    rtState = { status: 'complete', reason: null, unresolved: 0, lastSavedAt: iso(roundtable.completedAt) };
  } else if (castState.status !== 'complete') {
    rtState = { status: 'blocked', reason: 'Needs an approved cast.', unresolved: 0, lastSavedAt: null };
  } else {
    rtState = { status: 'available', reason: 'Ready to start.', unresolved: 0, lastSavedAt: null };
  }

  // ── 5. Report ──
  const results: WorkflowStepState = roundtable?.status === 'COMPLETED'
    ? { status: 'complete', reason: null, unresolved: 0, lastSavedAt: iso(roundtable.completedAt) }
    : { status: 'blocked', reason: 'No roundtable has completed yet.', unresolved: 0, lastSavedAt: null };

  return { DATA: data, BRIEF: briefState, PERSONAS: castState, SIMULATION: rtState, RESULTS: results };
}

/**
 * What an earlier-step change would touch downstream. Nothing is ever rewritten — cohorts and runs
 * keep the dataset version and brief version they were built from — but a person should see that
 * before making the change, not discover it afterwards.
 */
export async function downstreamImpact(projectId: string): Promise<{ cohorts: number; approvedCohorts: number; runs: number; completedRuns: number }> {
  const [cohorts, runs] = await Promise.all([
    prisma.cohort.findMany({ where: { projectId }, include: { personas: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { approval: true } } } } } }),
    prisma.run.findMany({ where: { projectId }, select: { status: true } }),
  ]);
  return {
    cohorts: cohorts.length,
    approvedCohorts: cohorts.filter((c) => c.personas.length > 0 && c.personas.every((p) => p.versions[0]?.approval === 'APPROVED')).length,
    runs: runs.filter((r) => r.status !== 'DRAFT').length,
    completedRuns: runs.filter((r) => r.status === 'COMPLETED' || r.status === 'COMPLETED_WITH_WARNINGS').length,
  };
}
