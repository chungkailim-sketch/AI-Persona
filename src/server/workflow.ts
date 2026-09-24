/**
 * The five-step workflow's state, computed from the tables of record on every render.
 *
 * Each step reports one status, a count of unresolved items and when it was last saved. A blocked
 * step always carries its reason (FR-83), and every step stays reachable — a blocked step explains
 * itself on arrival rather than being a dead control.
 */
import { prisma } from '@/lib/prisma';
import { assessUsability } from '@/ingest/pipeline';
import { assessBrief } from '@/server/brief';
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
const RUNNING = ['VALIDATING', 'QUEUED', 'PREPARING_CONTEXT', 'GENERATING_PERSONAS', 'INDEPENDENT_ASSESSMENT', 'CONSUMER_REACTION', 'CROSS_EXAMINATION', 'REVISION', 'SYNTHESIS', 'REPORT'];

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const latest = (...ds: (Date | null | undefined)[]) =>
  ds.filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

export async function computeWorkflowState(projectId: string): Promise<WorkflowState> {
  const [links, brief, briefReadiness, cohorts, runs] = await Promise.all([
    prisma.projectDataset.findMany({
      where: { projectId, dataset: { deletedAt: null } },
      include: { dataset: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, include: { governance: true } } } } },
    }),
    prisma.brief.findFirst({ where: { projectId }, orderBy: { versionNo: 'desc' }, select: { updatedAt: true } }),
    assessBrief(projectId),
    prisma.cohort.findMany({
      where: { projectId },
      orderBy: { generatedAt: 'desc' },
      include: { personas: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { approval: true, confidence: true } } } } },
    }),
    prisma.run.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, createdAt: true, completedAt: true, failureReason: true },
      take: 20,
    }),
  ]);

  // ── 1. Data ──
  const versions = links.map((l) => l.dataset.versions[0]).filter((v): v is NonNullable<typeof v> => Boolean(v));
  const verdicts = await Promise.all(versions.map((v) => assessUsability(v.id)));
  const usable = verdicts.filter((v) => v.usable).length;
  const dataUnresolved = verdicts.filter((v) => !v.usable).reduce((s, v) => s + v.blockers.length, 0);
  const dataSaved = latest(...versions.map((v) => v.createdAt), ...versions.map((v) => v.governance?.confirmedAt));
  let data: WorkflowStepState;
  if (versions.some((v) => INGESTING.includes(v.status))) {
    data = { status: 'running', reason: 'Ingestion in progress.', unresolved: dataUnresolved, lastSavedAt: iso(dataSaved) };
  } else if (versions.length > 0 && versions.every((v) => v.status === 'FAILED')) {
    data = { status: 'error', reason: 'Ingestion failed for every attached dataset.', unresolved: dataUnresolved, lastSavedAt: iso(dataSaved) };
  } else if (usable > 0) {
    data = { status: 'complete', reason: null, unresolved: dataUnresolved, lastSavedAt: iso(dataSaved) };
  } else if (versions.length > 0) {
    data = { status: 'warning', reason: `${dataUnresolved} item(s) to resolve before the data can be used.`, unresolved: dataUnresolved, lastSavedAt: iso(dataSaved) };
  } else {
    data = { status: 'available', reason: 'Nothing uploaded yet.', unresolved: 0, lastSavedAt: null };
  }

  // ── 2. Brief ──
  const briefState: WorkflowStepState = !brief
    ? { status: 'available', reason: 'Not started.', unresolved: 0, lastSavedAt: null }
    : briefReadiness.ready
      ? { status: 'complete', reason: null, unresolved: 0, lastSavedAt: iso(brief.updatedAt) }
      : { status: 'warning', reason: briefReadiness.missing[0] ?? 'Incomplete.', unresolved: briefReadiness.missing.length, lastSavedAt: iso(brief.updatedAt) };

  // ── 3. Personas ──
  const newest = cohorts[0];
  const pendingApproval = newest ? newest.personas.filter((p) => p.versions[0]?.approval !== 'APPROVED').length : 0;
  const lowConfidence = newest ? newest.personas.filter((p) => p.versions[0]?.confidence === 'LOW').length : 0;
  const anyApproved = cohorts.some((c) => c.personas.length > 0 && c.personas.every((p) => p.versions[0]?.approval === 'APPROVED'));
  let personas: WorkflowStepState;
  if (usable === 0 && cohorts.length === 0) {
    personas = { status: 'blocked', reason: 'Needs a dataset cleared for use in step 1.', unresolved: 0, lastSavedAt: null };
  } else if (anyApproved) {
    personas = { status: 'complete', reason: null, unresolved: lowConfidence, lastSavedAt: iso(newest?.generatedAt) };
  } else if (newest) {
    personas = { status: 'warning', reason: `${pendingApproval} persona(s) awaiting approval.`, unresolved: pendingApproval, lastSavedAt: iso(newest.generatedAt) };
  } else {
    personas = { status: 'available', reason: 'No cohort generated yet.', unresolved: 0, lastSavedAt: null };
  }

  // ── 4. Simulation ──
  const lastRun = runs[0];
  let simulation: WorkflowStepState;
  const prerequisites = [usable === 0 && 'a cleared dataset', !briefReadiness.ready && 'a complete brief', !anyApproved && 'an approved cohort'].filter(Boolean) as string[];
  if (runs.some((r) => RUNNING.includes(r.status))) {
    simulation = { status: 'running', reason: 'A run is in progress.', unresolved: 0, lastSavedAt: iso(lastRun?.createdAt) };
  } else if (lastRun?.status === 'FAILED') {
    simulation = { status: 'error', reason: 'The most recent run failed.', unresolved: 1, lastSavedAt: iso(lastRun.completedAt ?? lastRun.createdAt) };
  } else if (runs.some((r) => r.status === 'COMPLETED' || r.status === 'COMPLETED_WITH_WARNINGS')) {
    simulation = { status: lastRun?.status === 'COMPLETED_WITH_WARNINGS' ? 'warning' : 'complete', reason: lastRun?.status === 'COMPLETED_WITH_WARNINGS' ? 'Latest run completed with warnings.' : null, unresolved: 0, lastSavedAt: iso(lastRun?.completedAt ?? lastRun?.createdAt) };
  } else if (prerequisites.length > 0) {
    simulation = { status: 'blocked', reason: `Needs ${prerequisites.join(', ')}.`, unresolved: prerequisites.length, lastSavedAt: null };
  } else if (lastRun?.status === 'DRAFT') {
    simulation = { status: 'warning', reason: 'A planned run is waiting for confirmation.', unresolved: 1, lastSavedAt: iso(lastRun.createdAt) };
  } else {
    simulation = { status: 'available', reason: 'Ready to plan a run.', unresolved: 0, lastSavedAt: null };
  }

  // ── 5. Results ──
  const done = runs.find((r) => r.status === 'COMPLETED' || r.status === 'COMPLETED_WITH_WARNINGS');
  const results: WorkflowStepState = done
    ? { status: 'complete', reason: null, unresolved: 0, lastSavedAt: iso(done.completedAt) }
    : { status: 'blocked', reason: 'No run has completed yet.', unresolved: 0, lastSavedAt: null };

  return { DATA: data, BRIEF: briefState, PERSONAS: personas, SIMULATION: simulation, RESULTS: results };
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
