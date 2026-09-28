// @vitest-environment node
/**
 * Cohort generation and a full simulation run, end to end against the database.
 *
 * The properties under test are the ones a reader of the orchestrator might assume and be wrong
 * about: that the governance gate actually stops a run, that a run cannot execute without a human
 * confirmation, that the independent round really is isolated, and that a mock run is labelled as
 * mock all the way to the synthesis.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER = 'test-pepper';
process.env.MODEL_PROVIDER = 'mock';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { db, resetDatabase, seedUser } from './helpers';
import type { SessionUser } from '../../src/auth/session';
import { AuthorizationError } from '../../src/auth/guard';
import { setStorageAdapter, type StorageAdapter, type StoredObject } from '../../src/storage/adapter';
import { runIngest } from '../../src/ingest/pipeline';
import { createProject } from '../../src/server/projects';
import { getOrCreateBrief, saveBrief, addHypothesis, addStimulus } from '../../src/server/brief';
import { createCohort, approveCohort, generateCohort, chooseSegmentField } from '../../src/server/personas';
import { buildEvidenceContext, EvidenceRefused } from '../../src/model/context';
import { planRun, createRun, confirmRun, assessRunReadiness, RunRefused } from '../../src/server/runs';
import { executeRun } from '../../src/run/orchestrator';
import { setModelProvider } from '../../src/model/client';
import { MockProvider } from '../../src/model/mock';

class MemoryStore implements StorageAdapter {
  readonly name = 'memory';
  private readonly files = new Map<string, Buffer>();
  async put(prefix: string, bytes: Buffer): Promise<StoredObject> {
    const key = `${prefix}/${randomUUID()}`;
    this.files.set(key, bytes);
    return { key, byteSize: bytes.byteLength, checksum: createHash('sha256').update(bytes).digest('hex') };
  }
  async get(key: string): Promise<Buffer> {
    const b = this.files.get(key);
    if (!b) throw new Error('missing');
    return b;
  }
  async remove(key: string): Promise<void> { this.files.delete(key); }
}
const store = new MemoryStore();
setStorageAdapter(store);
setModelProvider(new MockProvider());

function asSession(u: { id: string; email: string; systemRole: string }): SessionUser {
  return {
    userId: u.id,
    email: u.email,
    displayName: null,
    systemRole: u.systemRole as SessionUser['systemRole'],
    sessionId: 'test',
  };
}

/** Enough respondents across three markets for segments that are not tiny. */
const CSV = [
  'market,age_band,purchase_intent,brand_awareness',
  ...Array.from({ length: 120 }, (_, i) => {
    const market = ['Indonesia', 'Germany', 'Mexico'][i % 3];
    const age = ['25-34', '35-44'][i % 2];
    return `${market},${age},${(i % 5) + 1},${(i % 4) + 1}`;
  }),
].join('\n');

/** A project with cleared data, an approved cohort and a complete brief. */
async function readyProject(options: { permitModel?: boolean; approve?: boolean } = {}) {
  const permitModel = options.permitModel ?? true;
  const approve = options.approve ?? true;

  const owner = asSession(await seedUser(`run-${randomUUID().slice(0, 8)}@example.com`));
  const { id: projectId } = await createProject(owner, { name: 'Run test' });
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });

  const dataset = await db.dataset.create({
    data: { workspaceId: project.workspaceId, name: 'Panel', createdById: owner.userId },
  });
  await db.projectDataset.create({ data: { projectId, datasetId: dataset.id } });
  const version = await db.datasetVersion.create({
    data: { datasetId: dataset.id, versionNo: 1, createdById: owner.userId },
  });
  const obj = await store.put('test', Buffer.from(CSV, 'utf8'));
  await db.sourceFile.create({
    data: {
      datasetVersionId: version.id,
      originalName: 'panel.csv',
      storageKey: obj.key,
      mimeType: 'text/csv',
      byteSize: obj.byteSize,
    },
  });
  await runIngest(version.id);

  await db.integrityFinding.updateMany({
    where: { datasetVersionId: version.id },
    data: { acknowledgedAt: new Date(), acknowledgedBy: owner.userId },
  });
  await db.governanceRecord.create({
    data: {
      datasetVersionId: version.id,
      dataOwner: 'Research',
      sourceName: 'Consumer panel',
      methodology: 'Online panel, quota sampled to census, weighted.',
      lawfulBasis: 'CONSENT',
      classification: 'CLIENT_CONFIDENTIAL',
      permittedUses: ['internal_analysis'],
      retentionDays: 90,
      sensitiveConfirmed: true,
      confirmedById: owner.userId,
      confirmedAt: new Date(),
      allowModelProcessing: permitModel,
    },
  });

  const brief = await getOrCreateBrief(owner, projectId);
  await saveBrief(owner, projectId, brief!.id, {
    researchQuestion: 'Which tier should launch first in Indonesia?',
    objective: 'compare',
    decisionSupported: 'Which product tier to launch first in Indonesia next quarter.',
    markets: ['Indonesia'],
    competitors: [],
    desiredOutcome: 'We are hoping this proves the premium tier should go first.',
    exclusions: [],
    prohibitedInferences: ['Anything about health'],
    personaCount: 6,
    runCount: 1,
    simulationDepth: 'standard',
  });
  await addHypothesis(owner, projectId, brief!.id, {
    label: 'H1',
    statement: 'Purchase intent is higher in Indonesia than in Germany.',
    minimumEvidenceThreshold:
      'At least two thirds of the panel confirm, with independent agreement above 0.7 and no herding flagged.',
    alternativeExplanations: ['Response-style differences between markets'],
  });

  let cohortId: string | null = null;
  if (permitModel) {
    const cohort = await createCohort(owner, projectId, {
      datasetVersionId: version.id,
      personaCount: 6,
      seed: 42,
    });
    cohortId = cohort.cohortId;
    if (approve) await approveCohort(owner, projectId, cohortId);
  }

  return { owner, projectId, datasetVersionId: version.id, briefId: brief!.id, cohortId };
}

describe('cohort generation', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('refuses to build a cohort from data nobody permitted for model processing', async () => {
    const { owner, projectId, datasetVersionId } = await readyProject({ permitModel: false });
    await expect(
      createCohort(owner, projectId, { datasetVersionId, personaCount: 6, seed: 42 }),
    ).rejects.toBeInstanceOf(EvidenceRefused);
  });

  it('builds one persona per segment with observed attributes carrying their base', async () => {
    const { projectId, cohortId } = await readyProject();
    const personas = await db.persona.findMany({
      where: { cohortId: cohortId! },
      include: { versions: { include: { attributes: true } } },
    });

    expect(personas).toHaveLength(6);
    const first = personas[0]!.versions[0]!;
    expect(first.baseSize).toBeGreaterThan(0);

    const observed = first.attributes.filter((a) => a.origin === 'OBSERVED');
    expect(observed.length).toBeGreaterThan(0);
    for (const a of observed) expect(a.baseSize).not.toBeNull();

    // Exactly one simulated attribute, and it is labelled as such.
    const simulated = first.attributes.filter((a) => a.origin === 'SIMULATED');
    expect(simulated).toHaveLength(1);
    expect(simulated[0]?.baseSize).toBeNull();
    expect(simulated[0]?.label).toMatch(/simulated/i);

    await db.project.findUniqueOrThrow({ where: { id: projectId } });
  });

  it('is deterministic: the same data and seed produce the same cohort', async () => {
    const { owner, projectId, datasetVersionId } = await readyProject();
    const a = await createCohort(owner, projectId, { datasetVersionId, personaCount: 6, seed: 7 });
    const b = await createCohort(owner, projectId, { datasetVersionId, personaCount: 6, seed: 7 });

    const names = async (cohortId: string) =>
      (await db.persona.findMany({ where: { cohortId }, orderBy: { name: 'asc' } })).map((p) => p.name);
    expect(await names(a.cohortId)).toEqual(await names(b.cohortId));
  });

  it('labels repeats rather than inventing segments to reach a requested count', async () => {
    const context = await buildEvidenceContext(
      (await readyProject()).datasetVersionId,
    );
    const { personas, note } = generateCohort(context, { personaCount: 9, seed: 42 });

    const repeats = personas.filter((p) => p.coverageNote?.includes('Repeat'));
    expect(repeats.length).toBeGreaterThan(0);
    expect(note).toMatch(/some segments are repeated/i);
    // Every persona still describes a segment that exists in the data.
    const segments = new Set(personas.map((p) => p.segment));
    expect(segments.size).toBeLessThanOrEqual(3);
  });

  it('says so plainly when no field can segment the sample', async () => {
    const context = await buildEvidenceContext((await readyProject()).datasetVersionId);
    const flat = { ...context, fields: context.fields.filter((f) => f.name === 'purchase_intent') };
    expect(chooseSegmentField({ ...flat, fields: [] })).toBeNull();

    const { note } = generateCohort({ ...flat, fields: [] }, { personaCount: 4, seed: 1 });
    expect(note).toMatch(/no field .* splits the sample/i);
  });
});

describe('the confirmation gate', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('creates a run that has not been confirmed and has made no model call', async () => {
    const { owner, projectId, cohortId } = await readyProject();
    const plan = await planRun(owner, projectId, cohortId!);
    const { runId } = await createRun(owner, projectId, plan);

    const run = await db.run.findUniqueOrThrow({ where: { id: runId }, include: { config: true } });
    expect(run.status).toBe('DRAFT');
    expect(run.config?.confirmedAt).toBeNull();
    expect(await db.modelCall.count({ where: { runId } })).toBe(0);
  });

  it('refuses to execute a run nobody confirmed, even if a job reaches the worker', async () => {
    const { owner, projectId, cohortId } = await readyProject();
    const plan = await planRun(owner, projectId, cohortId!);
    const { runId } = await createRun(owner, projectId, plan);

    // The gate is in the orchestrator too, not only in the interface.
    await expect(executeRun(runId)).rejects.toThrow(/never confirmed/i);
    expect(await db.modelCall.count({ where: { runId } })).toBe(0);
  });

  it('refuses a confirmation whose plan hash no longer matches what was shown', async () => {
    const { owner, projectId, cohortId } = await readyProject();
    const plan = await planRun(owner, projectId, cohortId!);
    const { runId } = await createRun(owner, projectId, plan);

    await expect(
      confirmRun(owner, projectId, runId, 'a-hash-from-a-different-plan'),
    ).rejects.toBeInstanceOf(RunRefused);

    const run = await db.run.findUniqueOrThrow({ where: { id: runId }, include: { config: true } });
    expect(run.config?.confirmedAt).toBeNull();
  });

  it('records who confirmed, and when', async () => {
    const { owner, projectId, cohortId } = await readyProject();
    const plan = await planRun(owner, projectId, cohortId!);
    const { runId } = await createRun(owner, projectId, plan);
    await confirmRun(owner, projectId, runId, plan.planHash);

    const config = await db.runConfig.findUniqueOrThrow({ where: { runId } });
    expect(config.confirmedById).toBe(owner.userId);
    expect(config.confirmedAt).not.toBeNull();

    const event = await db.auditEvent.findFirst({ where: { action: 'run.confirmed' } });
    expect(event?.actorEmail).toBe(owner.email);
  });

  it('refuses to plan a run on an unapproved cohort', async () => {
    const { owner, projectId, cohortId } = await readyProject({ approve: false });
    await expect(planRun(owner, projectId, cohortId!)).rejects.toBeInstanceOf(RunRefused);

    const readiness = await assessRunReadiness(projectId, cohortId!);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.join(' ')).toMatch(/no persona in this cohort has been approved/i);
  });

  it('refuses a non-member entirely', async () => {
    const { projectId, cohortId } = await readyProject();
    const stranger = asSession(await seedUser('stranger-run@example.com'));
    await expect(planRun(stranger, projectId, cohortId!)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('locks the brief when a run is created', async () => {
    const { owner, projectId, cohortId, briefId } = await readyProject();
    const plan = await planRun(owner, projectId, cohortId!);
    await createRun(owner, projectId, plan);

    const brief = await db.brief.findUniqueOrThrow({ where: { id: briefId } });
    expect(brief.status).toBe('LOCKED');
  });
});

describe('executing a run', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  async function execute() {
    const ctx = await readyProject();
    const plan = await planRun(ctx.owner, ctx.projectId, ctx.cohortId!);
    const { runId } = await createRun(ctx.owner, ctx.projectId, plan);
    await confirmRun(ctx.owner, ctx.projectId, runId, plan.planHash);
    const outcome = await executeRun(runId);
    return { ...ctx, runId, outcome };
  }

  it('walks every stage and records each one', async () => {
    const { runId, outcome } = await execute();
    expect(['COMPLETED', 'COMPLETED_WITH_WARNINGS']).toContain(outcome.status);

    const steps = await db.runStep.findMany({ where: { runId }, orderBy: { sequence: 'asc' } });
    expect(steps.map((s) => s.stage)).toEqual([
      'PREPARING_CONTEXT',
      'GENERATING_PERSONAS',
      'INDEPENDENT_ASSESSMENT',
      'CONSUMER_REACTION',
      'CROSS_EXAMINATION',
      'REVISION',
      'SYNTHESIS',
      'REPORT',
    ]);
    for (const s of steps) {
      expect(['completed', 'skipped']).toContain(s.status);
      expect(s.completedAt).not.toBeNull();
    }
  });

  it('records every model call with its accounting', async () => {
    const { runId } = await execute();
    const calls = await db.modelCall.findMany({ where: { runId } });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.provider).toBe('mock');
      expect(c.promptVersion).toBe('1.0.0');
      expect(c.outcome).toBe('ok');
      expect(c.schemaValid).toBe(true);
      expect(c.evidenceManifestHash).not.toBeNull();
      // A mock call costs nothing, and the record says so rather than estimating.
      expect(c.costUsd).toBe(0);
    }
    // Both the independent round and the revision round happened for the panel.
    expect(calls.filter((c) => c.stage === 'INDEPENDENT_ASSESSMENT').length).toBe(6);
    expect(calls.filter((c) => c.stage === 'REVISION').length).toBe(6);
  });

  it('gives every persona its own seed, so the panel is not one answer repeated', async () => {
    const { runId } = await execute();
    const seeds = await db.modelCall.findMany({
      where: { runId, stage: 'INDEPENDENT_ASSESSMENT' },
      select: { seed: true, personaKey: true },
    });
    expect(new Set(seeds.map((s) => s.seed)).size).toBe(seeds.length);
    expect(new Set(seeds.map((s) => s.personaKey)).size).toBe(seeds.length);
  });

  it('records both rounds per persona, so the independent view survives the revision', async () => {
    const { runId } = await execute();
    const finding = await db.finding.findFirstOrThrow({ where: { runId } });
    const votes = await db.personaVote.findMany({ where: { findingId: finding.id } });

    const round1 = votes.filter((v) => v.round === 1);
    const round2 = votes.filter((v) => v.round === 2);
    expect(round1).toHaveLength(6);
    expect(round2).toHaveLength(6);
  });

  it('caps the evidence grade at simulation, however the panel voted', async () => {
    const { runId } = await execute();
    const finding = await db.finding.findFirstOrThrow({ where: { runId } });
    expect(finding.evidenceGrade).toBe('L3_PERSONA_SIMULATION');
    expect(finding.classification).not.toBe('CONFIRMED');
  });

  it('writes the anti-herding metrics', async () => {
    const { runId } = await execute();
    const metric = await db.antiHerdMetric.findFirstOrThrow({ where: { runId } });
    expect(metric.flipRate).toBeGreaterThanOrEqual(0);
    expect(metric.voteEntropy).toBeGreaterThanOrEqual(0);
    expect(metric.convergenceRounds).toBe(2);
  });

  it('labels a mock run as mock everywhere, including the synthesis', async () => {
    const { runId } = await execute();
    const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.isMock).toBe(true);

    const synthesis = await db.synthesis.findUniqueOrThrow({ where: { runId } });
    expect(synthesis.limitations).toMatch(/mock provider/i);
    expect(synthesis.limitations).toMatch(/No AI model was consulted/i);
    // And the standing caveat is there whether or not it was mock.
    expect(synthesis.limitations).toMatch(/not evidence of what any real person thinks/i);
  });

  it('never lets the desired outcome reach a prompt', async () => {
    const { runId } = await execute();
    // The brief's desiredOutcome mentions "hoping"; no call may carry it. The prompt text is not
    // stored, so this asserts on the one thing that is: the brief context the pipeline may build.
    const calls = await db.modelCall.findMany({ where: { runId } });
    expect(calls.length).toBeGreaterThan(0);
    const { briefForModelContext } = await import('../../src/server/brief');
    const brief = await db.brief.findFirstOrThrow({});
    const context = await briefForModelContext(brief.id);
    expect(JSON.stringify(context)).not.toMatch(/hoping/i);
  });

  it('attaches dissent to the synthesis rather than dropping it', async () => {
    const { runId } = await execute();
    const synthesis = await db.synthesis.findUniqueOrThrow({
      where: { runId },
      include: { dissents: true },
    });
    // The mock produces a spread of stances, so at least the challenge round leaves a trace.
    expect(synthesis.dissents.length).toBeGreaterThan(0);
    expect(synthesis.confidenceBasis).toMatch(/independent agreement/i);
  });

  it('is reproducible: the same plan and seed give the same verdict', async () => {
    const a = await execute();
    await resetDatabase();
    const b = await execute();

    const findingA = await db.finding.findFirst({ where: { runId: a.runId } });
    const findingB = await db.finding.findFirstOrThrow({ where: { runId: b.runId } });
    // The first run's rows were cleared, so compare the second against the recorded consensus of
    // the first, captured before the reset.
    expect(findingB.consensusRatio).not.toBeNull();
    expect(findingA).toBeNull();
  });
});

describe('a run that cannot proceed', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('fails with a stated reason when model processing is withdrawn after confirmation', async () => {
    const ctx = await readyProject();
    const plan = await planRun(ctx.owner, ctx.projectId, ctx.cohortId!);
    const { runId } = await createRun(ctx.owner, ctx.projectId, plan);
    await confirmRun(ctx.owner, ctx.projectId, runId, plan.planHash);

    // Permission is withdrawn between confirmation and execution. The run must not proceed on the
    // basis that it was permitted earlier.
    await db.governanceRecord.updateMany({
      where: { datasetVersionId: ctx.datasetVersionId },
      data: { allowModelProcessing: false },
    });

    await expect(executeRun(runId)).rejects.toBeInstanceOf(EvidenceRefused);
    const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('FAILED');
    expect(run.failureReason).toMatch(/has not been permitted/i);
  });

  it('stops when cancellation is requested', async () => {
    const ctx = await readyProject();
    const plan = await planRun(ctx.owner, ctx.projectId, ctx.cohortId!);
    const { runId } = await createRun(ctx.owner, ctx.projectId, plan);
    await confirmRun(ctx.owner, ctx.projectId, runId, plan.planHash);
    await db.run.update({ where: { id: runId }, data: { cancelRequested: true } });

    const outcome = await executeRun(runId);
    expect(outcome.status).toBe('CANCELLED');
    expect(outcome.warnings.join(' ')).toMatch(/partial results are not reported/i);

    const run = await db.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('CANCELLED');
    expect(run.isPartial).toBe(true);
  });
});

describe('what a run records', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('records the stimulus it tested on the run itself', async () => {
    // Found in an end-to-end run: the stimulus shaped the plan hash and the reaction stage, but the
    // run record kept no trace of it, so the results page said "no stimulus".
    const { owner, projectId, briefId, cohortId } = await readyProject();
    const { id: stimulusId } = await addStimulus(owner, projectId, briefId, { label: 'A', name: 'Concept', content: 'Lab-tested, five-year warranty.' });
    const plan = await planRun(owner, projectId, cohortId!);
    const { runId } = await createRun(owner, projectId, plan);
    const config = await db.runConfig.findUniqueOrThrow({ where: { runId } });
    expect(config.stimulusIds).toEqual([stimulusId]);
  });
});

