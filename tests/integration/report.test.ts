// @vitest-environment node
/**
 * Report assembly and export, against the database.
 *
 * The properties under test are the ones that decide whether a caveat survives contact with a
 * document someone forwards: that the limitations block cannot be absent, that a blocked claim
 * cannot be exported silently, and that an override is carried in the file itself rather than only
 * in a log the recipient will never see.
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
import { createCohort, approveCohort } from '../../src/server/personas';
import { planRun, createRun, confirmRun } from '../../src/server/runs';
import { executeRun } from '../../src/run/orchestrator';
import { setModelProvider } from '../../src/model/client';
import { MockProvider } from '../../src/model/mock';
import { assembleReport, renderMarkdown } from '../../src/report/assemble';
import { exportReport, checkReport, ExportBlocked } from '../../src/report/export';

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

const CSV = [
  'market,age_band,purchase_intent,brand_awareness',
  ...Array.from({ length: 120 }, (_, i) => {
    const market = ['Indonesia', 'Germany', 'Mexico'][i % 3];
    return `${market},${['25-34', '35-44'][i % 2]},${(i % 5) + 1},${(i % 4) + 1}`;
  }),
].join('\n');

/** A project carried all the way to a completed run. */
async function completedRun() {
  const owner = asSession(await seedUser(`rep-${randomUUID().slice(0, 8)}@example.com`));
  const { id: projectId } = await createProject(owner, { name: 'Report test' });
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
      allowModelProcessing: true,
    },
  });

  const brief = await getOrCreateBrief(owner, projectId);
  await saveBrief(owner, projectId, brief!.id, {
    researchQuestion: 'Which market should launch first?',
    objective: 'compare',
    decisionSupported: 'Which market to launch the premium tier in first next quarter.',
    markets: ['Indonesia'],
    competitors: [],
    exclusions: [],
    prohibitedInferences: [],
    personaCount: 6,
    runCount: 1,
    simulationDepth: 'standard',
  });
  await addHypothesis(owner, projectId, brief!.id, {
    label: 'H1',
    statement: 'Purchase intent is higher in Indonesia than in Germany.',
    minimumEvidenceThreshold:
      'Two thirds of the panel confirm, independent agreement above 0.7, no herding flagged.',
    alternativeExplanations: ['Response-style differences between markets'],
  });

  const cohort = await createCohort(owner, projectId, {
    datasetVersionId: version.id,
    personaCount: 6,
    seed: 42,
  });
  await approveCohort(owner, projectId, cohort.cohortId);

  const plan = await planRun(owner, projectId, cohort.cohortId);
  const { runId } = await createRun(owner, projectId, plan);
  await confirmRun(owner, projectId, runId, plan.planHash);
  await executeRun(runId);

  return { owner, projectId, runId, datasetVersionId: version.id };
}

describe('assembling a report', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('always carries a limitations block, and leads it with the simulation caveat', async () => {
    const { owner, projectId, runId } = await completedRun();
    const report = await assembleReport(owner, projectId, runId);

    expect(report.limitations.length).toBeGreaterThan(0);
    expect(report.limitations.join(' ')).toMatch(/not evidence of what any real person thinks/i);
    // A mock run says so first, before anything else.
    expect(report.limitations[0]).toMatch(/mock provider/i);
  });

  it('does not flag the run’s own computed figures as unsupported', async () => {
    // Found in an end-to-end run: "only 33% supported the claim" — a share of recorded votes — was
    // refused as a figure with no source, so every correct report needed an override to export.
    const { owner, projectId, runId } = await completedRun();
    const report = await assembleReport(owner, projectId, runId);
    const figures = checkReport(report).flatMap((c) => c.issues).filter((i) => i.kind === 'unsupported_figure');
    expect(figures).toEqual([]);
  });

  it('shows the threshold set before the run beside what the run found', async () => {
    const { owner, projectId, runId } = await completedRun();
    const report = await assembleReport(owner, projectId, runId);

    expect(report.hypotheses).toHaveLength(1);
    expect(report.hypotheses[0]?.minimumEvidenceThreshold).toMatch(/two thirds/i);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it('records both rounds per persona, so the independent view is inspectable', async () => {
    const { owner, projectId, runId } = await completedRun();
    const report = await assembleReport(owner, projectId, runId);

    const votes = report.findings[0]?.votes ?? [];
    expect(votes).toHaveLength(6);
    for (const v of votes) {
      expect(v.independent).not.toBeNull();
      expect(v.final).not.toBeNull();
    }
  });

  it('says plainly when the evidence is no longer available, rather than showing a gap', async () => {
    const { owner, projectId, runId, datasetVersionId } = await completedRun();
    // Permission withdrawn after the run completed.
    await db.governanceRecord.updateMany({
      where: { datasetVersionId },
      data: { allowModelProcessing: false },
    });

    const report = await assembleReport(owner, projectId, runId);
    expect(report.evidence[0]?.datasetName).toBe('Withdrawn');
    expect(report.evidence[0]?.caveats.join(' ')).toMatch(/can no longer be shown/i);
    expect(report.evidence[0]?.caveats.join(' ')).toMatch(/cannot currently be traced/i);
  });

  it('refuses a reader who is not a member', async () => {
    const { projectId, runId } = await completedRun();
    const stranger = asSession(await seedUser('stranger-report@example.com'));
    await expect(assembleReport(stranger, projectId, runId)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});

describe('rendering markdown', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('puts the caveats before the detail, not in an appendix', async () => {
    const { owner, projectId, runId } = await completedRun();
    const md = renderMarkdown(await assembleReport(owner, projectId, runId));

    const caveatAt = md.indexOf('What this cannot support');
    const findingsAt = md.indexOf('## Findings');
    expect(caveatAt).toBeGreaterThan(-1);
    expect(findingsAt).toBeGreaterThan(-1);
    expect(caveatAt).toBeLessThan(findingsAt);
  });

  it('leads a mock run with the mock notice', async () => {
    const { owner, projectId, runId } = await completedRun();
    const md = renderMarkdown(await assembleReport(owner, projectId, runId));
    expect(md.slice(0, 400)).toMatch(/mock provider/i);
  });

  it('carries the plan hash so a run can be reproduced', async () => {
    const { owner, projectId, runId } = await completedRun();
    const report = await assembleReport(owner, projectId, runId);
    const md = renderMarkdown(report);
    expect(md).toContain(report.planHash);
    expect(md).toMatch(/asked the same question of the same material in the same way/);
  });
});

describe('exporting', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('refuses a mock run outright, because no claim can rest on it', async () => {
    const { owner, projectId, runId } = await completedRun();
    await expect(exportReport(owner, projectId, runId, 'markdown')).rejects.toBeInstanceOf(
      ExportBlocked,
    );
  });

  it('records a blocked attempt rather than failing silently', async () => {
    const { owner, projectId, runId } = await completedRun();
    await expect(exportReport(owner, projectId, runId, 'markdown')).rejects.toThrow();

    const record = await db.reportExport.findFirstOrThrow({ where: { runId } });
    expect(record.blocked).toBe(true);
    expect(record.blockReason).toBeTruthy();

    const event = await db.auditEvent.findFirst({ where: { action: 'report.export.blocked' } });
    expect(event?.actorEmail).toBe(owner.email);
  });

  it('exports over a block only with a substantial written reason', async () => {
    const { owner, projectId, runId } = await completedRun();

    // Too short: still refused.
    await expect(
      exportReport(owner, projectId, runId, 'markdown', { acknowledgeBlocks: 'fine' }),
    ).rejects.toBeInstanceOf(ExportBlocked);

    const result = await exportReport(owner, projectId, runId, 'markdown', {
      acknowledgeBlocks:
        'Exporting for an internal methodology review only; nobody will read these as findings.',
    });
    expect(result.overrideNote).toMatch(/Exported over/);
    expect(result.overrideNote).toContain(owner.email);
  });

  it('writes the override into the file itself, not only the audit log', async () => {
    const { owner, projectId, runId } = await completedRun();
    const result = await exportReport(owner, projectId, runId, 'markdown', {
      acknowledgeBlocks:
        'Exporting for an internal methodology review only; nobody will read these as findings.',
    });

    // A recipient two months later has no audit log. They have this file.
    expect(result.content.slice(0, 600)).toMatch(/claim check was overridden/i);
    expect(result.content).toMatch(/internal methodology review/);
  });

  it('records the override against a name and time', async () => {
    const { owner, projectId, runId } = await completedRun();
    await exportReport(owner, projectId, runId, 'markdown', {
      acknowledgeBlocks:
        'Exporting for an internal methodology review only; nobody will read these as findings.',
    });

    const record = await db.reportExport.findFirstOrThrow({
      where: { runId, blocked: false },
    });
    expect(record.reviewerAckById).toBe(owner.userId);
    expect(record.reviewerAckAt).not.toBeNull();

    const event = await db.auditEvent.findFirst({ where: { action: 'report.export.overridden' } });
    expect(event?.reason).toMatch(/internal methodology review/);
  });

  it('carries the limitations into a JSON export too', async () => {
    const { owner, projectId, runId } = await completedRun();
    const result = await exportReport(owner, projectId, runId, 'json', {
      acknowledgeBlocks:
        'Exporting for an internal methodology review only; nobody will read these as findings.',
    });

    const parsed = JSON.parse(result.content) as {
      limitations: string[];
      notice: string;
      override: string;
    };
    expect(parsed.limitations.length).toBeGreaterThan(0);
    expect(parsed.notice).toMatch(/is not optional/i);
    expect(parsed.override).toMatch(/Exported over/);
  });

  it('refuses a user without the export permission', async () => {
    const { projectId, runId } = await completedRun();
    const viewer = asSession(await seedUser('viewer-export@example.com'));
    await db.projectMember.create({
      data: { projectId, userId: viewer.userId, role: 'VIEWER' },
    });

    await expect(exportReport(viewer, projectId, runId, 'markdown')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});

describe('the claim check over a real report', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('checks every claim-bearing field, not just the headline', async () => {
    const { owner, projectId, runId } = await completedRun();
    const report = await assembleReport(owner, projectId, runId);
    const checked = checkReport(report);

    // Mock runs flag everything, which is the point — it confirms every field is being checked.
    expect(checked.length).toBeGreaterThanOrEqual(3);
  });

  it('passes a well-worded finding once the run is not mock', async () => {
    const { owner, projectId, runId } = await completedRun();
    // Simulate a non-mock run so the blanket mock block lifts and the wording is what is tested.
    await db.run.update({ where: { id: runId }, data: { isMock: false } });
    await db.finding.updateMany({
      where: { runId },
      data: { claim: 'The simulated panel leaned against the claim in this dataset.' },
    });
    await db.synthesis.updateMany({
      where: { runId },
      data: {
        executiveSummary: 'The simulated panel did not settle on a position.',
        directAnswer: 'Unresolved: the panel split, and the disagreement is itself the finding.',
        qualifiedRecommendation: 'Treat this as a hypothesis to test with real people.',
      },
    });

    const report = await assembleReport(owner, projectId, runId);
    const blocking = checkReport(report).flatMap((c) =>
      c.issues.filter((i) => i.severity === 'blocking'),
    );
    expect(blocking).toEqual([]);
  });
});
