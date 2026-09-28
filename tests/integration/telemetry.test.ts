// @vitest-environment node
/**
 * Live telemetry against the real database: ingestion and runs emit events at real transitions,
 * the reducers turn them into the states the interface draws, a reader resumes from a cursor and
 * reconciles with the snapshot, and nobody can read another project's stream.
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
import { getOrCreateBrief, saveBrief, addHypothesis } from '../../src/server/brief';
import { createCohort, approveCohort, generateCohort, chooseSegmentField } from '../../src/server/personas';
import { buildEvidenceContext, EvidenceRefused } from '../../src/model/context';
import { planRun, createRun, confirmRun, assessRunReadiness, RunRefused } from '../../src/server/runs';
import { executeRun } from '../../src/run/orchestrator';
import { authorizeStream, readEventsAfter, readRecentEvents, readSnapshot, StreamRefused } from '../../src/telemetry/read';
import { TelemetryEventSchema, INGEST_STAGES } from '../../src/telemetry/contract';
import { aggregateRunMetrics, effectiveRunStatus, reducePipeline, reduceRunStages } from '../../src/telemetry/reduce';
import { FixtureTransport } from '../../src/ui/live/transport';
import { emitApprovalIfUsable } from '../../src/ingest/pipeline';
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


describe('ingestion telemetry', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('updates the pipeline stages from the events runIngest records', async () => {
    const { projectId, datasetVersionId } = await readyProject({ permitModel: false });
    const events = await readRecentEvents({ projectId, datasetVersionId }, 1000);
    expect(events.length).toBeGreaterThan(10);
    for (const e of events) expect(TelemetryEventSchema.safeParse(e).success).toBe(true);

    const p = reducePipeline(events);
    expect(p.source).toBe('events');
    for (const key of ['file_identification', 'parsing', 'schema_detection', 'field_mapping', 'data_profiling', 'duplicate_detection', 'missing_values', 'outlier_analysis', 'sensitive_detection', 'quality_assessment', 'evidence_preparation', 'ready_for_review'] as const) {
      expect(['completed', 'warning']).toContain(p.stages[key].status);
    }
    // Governance was written directly in this fixture, so no approval event was ever emitted.
    expect(p.stages.import_approved.status).toBe('awaiting');
    expect(p.failed).toBeNull();
  });

  it('records the approval once the version becomes usable, and only once', async () => {
    const { projectId, datasetVersionId } = await readyProject({ permitModel: true });
    await emitApprovalIfUsable(datasetVersionId, 'tester@example.com');
    await emitApprovalIfUsable(datasetVersionId, 'tester@example.com');
    const events = await readRecentEvents({ projectId, datasetVersionId }, 1000);
    expect(events.filter((e) => e.stage === 'import_approved' && e.status === 'completed')).toHaveLength(1);
    expect(reducePipeline(events).stages.import_approved.status).toBe('completed');
  });

  it('never carries a cell value in an event', async () => {
    const { projectId, datasetVersionId } = await readyProject({ permitModel: false });
    const events = await readRecentEvents({ projectId, datasetVersionId }, 1000);
    const text = JSON.stringify(events);
    // Values from the CSV body: markets appear only as data, never in the stream.
    expect(text).not.toMatch(/Indonesia|Germany|Mexico/);
  });

  it('stops the pipeline at the stage that failed', async () => {
    const owner = asSession(await seedUser('fail@example.com'));
    const { id: projectId } = await createProject(owner, { name: 'Fail' });
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    const dataset = await db.dataset.create({ data: { workspaceId: project.workspaceId, name: 'Broken', createdById: owner.userId } });
    await db.projectDataset.create({ data: { projectId, datasetId: dataset.id } });
    const version = await db.datasetVersion.create({ data: { datasetId: dataset.id, versionNo: 1, createdById: owner.userId } });
    await db.sourceFile.create({ data: { datasetVersionId: version.id, originalName: 'gone.csv', storageKey: 'missing/key', mimeType: 'text/csv', byteSize: 1 } });
    const outcome = await runIngest(version.id);
    expect(outcome.status).toBe('FAILED');
    const p = reducePipeline(await readRecentEvents({ projectId, datasetVersionId: version.id }));
    expect(p.failed).toBe('parsing');
    expect(p.stages.schema_detection.status).toBe('pending');
  });
});

describe('run telemetry', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  async function execute() {
    const ctx = await readyProject();
    const plan = await planRun(ctx.owner, ctx.projectId, ctx.cohortId!);
    const { runId } = await createRun(ctx.owner, ctx.projectId, plan);
    await confirmRun(ctx.owner, ctx.projectId, runId, plan.planHash);
    await executeRun(runId);
    return { ...ctx, runId };
  }

  it('updates metrics and stages from the events a run records, consistent with the tables of record', async () => {
    const { projectId, runId } = await execute();
    const events = await readRecentEvents({ projectId, runId }, 1000);
    const snapshot = await readSnapshot({ projectId, runId });
    expect(snapshot.run!.status).toMatch(/^COMPLETED/);

    const m = aggregateRunMetrics(events, snapshot.run, Date.now());
    const answers = await db.modelCall.groupBy({ by: ['stage', 'personaKey'], where: { runId } });
    expect(m.callsCompleted).toBe(answers.length);
    expect(m.pass + m.flag + m.fail).toBe(answers.length);
    expect(m.callsPerMinute).toBeNull();

    const stages = reduceRunStages(events, snapshot.run);
    expect(stages.INDEPENDENT_ASSESSMENT.status).toBe('completed');
    expect(stages.REPORT.status).toBe('completed');
    expect(stages.CONSUMER_REACTION.status).toBe('not_performed'); // no stimulus in this brief
    expect(effectiveRunStatus(events, snapshot.run!.status)).toBe(snapshot.run!.status);
    for (const e of events) expect(e.isMock).toBe(true);
  });

  it('never streams a rationale, prompt or the desired outcome', async () => {
    const { projectId, runId } = await execute();
    const text = JSON.stringify(await readRecentEvents({ projectId, runId }, 1000));
    expect(text).not.toMatch(/hoping this proves/i);
    expect(text).not.toMatch(/You are answering as/);
    const rationales = await db.modelCall.count({ where: { runId } });
    expect(rationales).toBeGreaterThan(0);
    expect(text).not.toMatch(/"rationale"/);
  });

  it('resumes after a cursor without gaps or duplicates, and the snapshot reports the same cursor', async () => {
    const { projectId, runId } = await execute();
    const all = await readRecentEvents({ projectId, runId }, 1000);
    const cut = all[Math.floor(all.length / 2)]!.seq;
    const rest = await readEventsAfter({ projectId, runId }, cut, 1000);
    expect(rest[0]!.seq).toBeGreaterThan(cut);
    expect(all.filter((e) => e.seq <= cut).length + rest.length).toBe(all.length);
    const snap = await readSnapshot({ projectId, runId });
    expect(snap.cursor).toBe(all[all.length - 1]!.seq);
  });

  it('refuses a non-member, and a member who names another project\'s run', async () => {
    const { projectId, runId } = await execute();
    const outsider = asSession(await seedUser('outsider@example.com'));
    await expect(authorizeStream(outsider, { projectId, runId })).rejects.toBeInstanceOf(StreamRefused);

    const { id: otherProject } = await createProject(outsider, { name: 'Mine' });
    await expect(authorizeStream(outsider, { projectId: otherProject, runId })).rejects.toBeInstanceOf(StreamRefused);
    await expect(authorizeStream(outsider, { projectId: otherProject })).resolves.toBeUndefined();
    expect(await readEventsAfter({ projectId: otherProject }, 0)).toHaveLength(0);
  });

  it('uses the same contract for fixture (mock) and live events', async () => {
    const { projectId, runId } = await execute();
    const live = await readRecentEvents({ projectId, runId }, 50);
    const replayed: unknown[] = [];
    new FixtureTransport([live]).start({ onEvents: (e) => replayed.push(...e), onSnapshot: () => {}, onStatus: () => {} });
    for (const e of [...live, ...replayed]) expect(TelemetryEventSchema.safeParse(e).success).toBe(true);
    expect(INGEST_STAGES.length).toBe(16);
  });

  it('persists a theme preference on the user', async () => {
    const u = await seedUser('theme@example.com');
    expect(u.themePreference).toBe('system');
    await db.user.update({ where: { id: u.id }, data: { themePreference: 'dark' } });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).themePreference).toBe('dark');
  });
});
