// @vitest-environment node
/**
 * A persona agent-swarm debate end to end, against the database, with the mock provider.
 *
 * What is under test is everything around the model: that evidence comes only from cleared data
 * and only from statements about the motion, that openings are isolated, that the phases run in
 * order, that the segment comparison is computed from the data, and that a mock debate says so.
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
import { setStorageAdapter, type StorageAdapter, type StoredObject } from '../../src/storage/adapter';
import { runIngest } from '../../src/ingest/pipeline';
import { createProject } from '../../src/server/projects';
import { createCohort, approveCohort } from '../../src/server/personas';
import { setModelProvider } from '../../src/model/client';
import { MockProvider } from '../../src/model/mock';
import { requestDebate, DebateRequestRefused } from '../../src/debate/service';
import { executeDebate } from '../../src/debate/engine';

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

const asSession = (u: { id: string; email: string; systemRole: string }): SessionUser => ({
  userId: u.id, email: u.email, displayName: null, systemRole: u.systemRole as SessionUser['systemRole'], sessionId: 'test',
});

/** A long survey table: two AI-advertising statements, one unrelated, three segments, two waves. */
function longCsv(): string {
  const header = 'market,wave,wave_year,wave_month,question_id,statement,response,segment_group,segment,sample_base,share';
  const lines: string[] = [header];
  const shares: Record<string, Record<string, number>> = {
    'I trust adverts shown by AI assistants': { All: 38, '16-24': 55, '25-34': 30, '35-44': 29 },
    'AI chatbots favour sponsored products': { All: 47, '16-24': 44, '25-34': 50, '35-44': 48 },
    'I enjoy cooking at home': { All: 60, '16-24': 58, '25-34': 61, '35-44': 62 },
  };
  const bases: Record<string, number> = { All: 1000, '16-24': 400, '25-34': 400, '35-44': 200 };
  for (const [year, month, shift] of [[2025, 'March', -5], [2026, 'March', 0]] as const) {
    for (const [statement, bySeg] of Object.entries(shares)) {
      const q = statement.startsWith('I enjoy') ? 'Q9' : 'Q4';
      for (const [seg, share] of Object.entries(bySeg)) {
        for (const [response, v] of [['Agree', share + shift], ['Disagree', 100 - share - shift]] as const) {
          lines.push(['China', `${month} ${year}`, year, month, q, `"${statement}"`, response, seg === 'All' ? 'All' : 'Age groups', seg, bases[seg], v].join(','));
        }
      }
    }
  }
  return lines.join('\n');
}

async function readyProject(opts: { permitModel?: boolean; approve?: boolean } = {}) {
  const owner = asSession(await seedUser(`debate-${randomUUID().slice(0, 8)}@example.com`));
  const { id: projectId } = await createProject(owner, { name: 'Debate test' });
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const dataset = await db.dataset.create({ data: { workspaceId: project.workspaceId, name: 'Mintel — China', createdById: owner.userId } });
  await db.projectDataset.create({ data: { projectId, datasetId: dataset.id } });
  const version = await db.datasetVersion.create({ data: { datasetId: dataset.id, versionNo: 1, createdById: owner.userId } });
  const obj = await store.put('test', Buffer.from(longCsv(), 'utf8'));
  await db.sourceFile.create({ data: { datasetVersionId: version.id, originalName: 'china.csv', storageKey: obj.key, mimeType: 'text/csv', byteSize: obj.byteSize } });
  await runIngest(version.id);
  await db.integrityFinding.updateMany({ where: { datasetVersionId: version.id }, data: { acknowledgedAt: new Date(), acknowledgedBy: owner.userId } });
  await db.datasetField.updateMany({ where: { datasetVersionId: version.id }, data: { excluded: false, inclusionJustification: 'Aggregate survey shares; reviewed.' } });
  await db.governanceRecord.create({
    data: {
      datasetVersionId: version.id, dataOwner: 'Research', sourceName: 'Mintel', methodology: 'Online panel, published shares.',
      lawfulBasis: 'LEGITIMATE_INTEREST', classification: 'CLIENT_CONFIDENTIAL', permittedUses: ['internal_analysis'], retentionDays: 90,
      sensitiveConfirmed: true, confirmedById: owner.userId, confirmedAt: new Date(), allowModelProcessing: true,
    },
  });
  const cohort = await createCohort(owner, projectId, { datasetVersionId: version.id, personaCount: 3, seed: 7, segmentFieldName: 'segment' });
  if (opts.approve ?? true) await approveCohort(owner, projectId, cohort.cohortId);
  if (opts.permitModel === false) {
    await db.governanceRecord.update({ where: { datasetVersionId: version.id }, data: { allowModelProcessing: false } });
  }
  return { owner, projectId, cohortId: cohort.cohortId, datasetVersionId: version.id };
}

const TOPIC = 'Can advertising inside AI assistants like ChatGPT be trusted, or will it be biased towards sponsored products?';
const HYPOTHESIS = '15-24s are more susceptible to AI advertising than 25-34s';

describe('persona agent-swarm debate', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('runs every phase in order and ends with a reference conclusion beside a comparison computed from the data', async () => {
    const { owner, projectId, cohortId } = await readyProject();
    const { debateId } = await requestDebate(owner, projectId, { cohortId, topic: TOPIC, hypothesis: HYPOTHESIS, rounds: 2 });
    expect(await db.job.count({ where: { kind: 'debate' } })).toBe(1);

    const outcome = await executeDebate(debateId);
    expect(outcome.status).toBe('COMPLETED');

    const debate = await db.debate.findUniqueOrThrow({ where: { id: debateId }, include: { turns: { orderBy: { seq: 'asc' } } } });
    expect(debate.isMock).toBe(true);

    // Phase order: framing, isolated openings, review, (moderation, rebuttals, challenge) × 2, closings, verdict.
    const phases = debate.turns.map((t) => t.phase).filter((p, i, a) => p !== a[i - 1]);
    expect(phases).toEqual(['FRAMING', 'OPENING', 'EVIDENCE_REVIEW', 'MODERATION', 'REBUTTAL', 'CHALLENGE', 'MODERATION', 'REBUTTAL', 'CHALLENGE', 'CLOSING', 'VERDICT']);
    const personaKeys = new Set(debate.turns.filter((t) => t.phase === 'OPENING').map((t) => t.agentKey));
    expect(personaKeys.size).toBe(3);

    // The swarm saw only the statements about the motion, from the latest wave.
    const evidence = debate.evidence as { items: { statement: string; wave: string }[]; focus: { requested: string; matched: string | null }[]; comparison: { segments: string[]; higherA: number } };
    expect(new Set(evidence.items.map((i) => i.statement))).toEqual(new Set(['I trust adverts shown by AI assistants', 'AI chatbots favour sponsored products']));
    expect(new Set(evidence.items.map((i) => i.wave))).toEqual(new Set(['March 2026']));
    // "15-24" is not published; the closest break is used and the mapping recorded.
    expect(evidence.focus.map((f) => f.matched)).toEqual(['16-24', '25-34']);
    expect(evidence.comparison.segments).toEqual(['16-24', '25-34']);
    // 55% vs 30% trust on bases of 400 is a real difference; the code finds it whatever the agents said.
    expect(evidence.comparison.higherA).toBeGreaterThanOrEqual(1);

    // Citations point at real evidence only.
    for (const t of debate.turns) {
      const ids = (t.content as { evidenceIds?: string[] }).evidenceIds ?? [];
      for (const id of ids) expect(evidence.items.length).toBeGreaterThanOrEqual(Number(id.slice(1)));
    }

    const metrics = debate.metrics as { panelSize: number; entropy: number };
    expect(metrics.panelSize).toBe(3);
    const conclusion = debate.conclusion as { verdict: { answer: string } | null; caveats: string[] };
    expect(conclusion.verdict?.answer).toBeTruthy();
    expect(conclusion.caveats.join(' ')).toMatch(/mock provider/);

    // Every model call is accounted to the debate, none to a run.
    const calls = await db.modelCall.findMany({ where: { debateId } });
    expect(calls.length).toBe(debate.turns.length);
    expect(calls.every((c) => c.runId === null && c.provider === 'mock')).toBe(true);
  });

  it('refuses to debate on data nobody permitted for model processing, and says why', async () => {
    const { owner, projectId, cohortId } = await readyProject({ permitModel: false });
    const { debateId } = await requestDebate(owner, projectId, { cohortId, topic: TOPIC });
    const outcome = await executeDebate(debateId);
    expect(outcome.status).toBe('FAILED');
    const debate = await db.debate.findUniqueOrThrow({ where: { id: debateId } });
    expect(debate.failureReason).toMatch(/No dataset in this project can be used/);
    expect(await db.modelCall.count({ where: { debateId } })).toBe(0);
  });

  it('names a dataset whose stored files are missing, instead of stopping on an internal error', async () => {
    const { owner, projectId, cohortId } = await readyProject();
    const { debateId } = await requestDebate(owner, projectId, { cohortId, topic: TOPIC });
    // Throws ENOENT on read, exactly as the local disk store does.
    const get = store.get.bind(store);
    store.get = async () => { throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }); };
    try {
      const outcome = await executeDebate(debateId);
      expect(outcome.status).toBe('FAILED');
      const debate = await db.debate.findUniqueOrThrow({ where: { id: debateId } });
      expect(debate.failureReason).toMatch(/stored data files are missing/);
      expect(debate.failureReason).not.toMatch(/internal error/);
    } finally {
      store.get = get;
    }
  });

  it('will not start on a cohort nobody approved, or on a one-word topic', async () => {
    const { owner, projectId, cohortId } = await readyProject({ approve: false });
    await expect(requestDebate(owner, projectId, { cohortId, topic: 'ads?' })).rejects.toBeInstanceOf(DebateRequestRefused);
    await expect(requestDebate(owner, projectId, { cohortId, topic: 'ads?' })).rejects.toMatchObject({
      problems: expect.arrayContaining([expect.stringMatching(/at least two approved personas/), expect.stringMatching(/at least a sentence/)]),
    });
  });
});
