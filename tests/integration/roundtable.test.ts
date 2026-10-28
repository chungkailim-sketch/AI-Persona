// @vitest-environment node
/**
 * The simplified journey end to end, against the database, with the mock provider: brief → cast of
 * markets × three income tiers → approval → roundtable → computed view and market indices.
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
import { setModelProvider } from '../../src/model/client';
import { MockProvider } from '../../src/model/mock';
import {
  approveCast,
  availableMarkets,
  JourneyRefused,
  latestCast,
  marketInputs,
  requestCast,
  requestRoundtable,
  saveMarketInputs,
  saveStudyBrief,
  DEFAULT_CATEGORIES,
  DEFAULT_QUESTION,
} from '../../src/roundtable/service';
import { executeCast, executeRoundtable, roundtableView, type CastProfile, type ScoredCategory } from '../../src/roundtable/engine';
import { entryIndex, potentialIndex } from '../../src/roundtable/marketIndex';

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

const BANDS: Record<string, string[]> = {
  Indonesia: ['Less than IDR 3 million', 'IDR 3-5 million', 'IDR 5-10 million', 'IDR 10-20 million', 'IDR 20 million or more'],
  Thailand: ['Less than THB 15,000', 'THB 15,000-30,000', 'THB 30,000-50,000', 'THB 50,000 or more'],
};

function csv(): string {
  const lines = ['market,wave,wave_year,wave_month,question_id,statement,response,segment_group,segment,sample_base,share'];
  for (const [market, bands] of Object.entries(BANDS)) {
    for (const [q, statement, all] of [['Q1', 'I prefer premium brands', 40], ['Q2', 'I look for the lowest price', 55], ['Q3', 'I try new brands often', 35]] as const) {
      const rows: [string, string, number, number][] = [['All', 'All', 1000, all]];
      bands.forEach((b, i) => {
        const tilt = (i - (bands.length - 1) / 2) * 8;
        rows.push(['Monthly household income', b, 200, Math.max(1, Math.min(99, all + (q === 'Q2' ? -tilt : tilt)))]);
      });
      for (const [group, seg, base, share] of rows) {
        for (const [response, v] of [['Agree', share], ['Disagree', 100 - share]] as const) {
          lines.push([market, 'March 2026', 2026, 'March', q, `"${statement}"`, response, group, `"${seg}"`, base, v].join(','));
        }
      }
    }
  }
  return lines.join('\n');
}

async function readyProject() {
  const owner = asSession(await seedUser(`rt-${randomUUID().slice(0, 8)}@example.com`));
  const { id: projectId } = await createProject(owner, { name: 'Roundtable test' });
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const dataset = await db.dataset.create({ data: { workspaceId: project.workspaceId, name: 'Mintel — SEA', createdById: owner.userId } });
  await db.projectDataset.create({ data: { projectId, datasetId: dataset.id } });
  const version = await db.datasetVersion.create({ data: { datasetId: dataset.id, versionNo: 1, createdById: owner.userId } });
  const obj = await store.put('test', Buffer.from(csv(), 'utf8'));
  await db.sourceFile.create({ data: { datasetVersionId: version.id, originalName: 'sea.csv', storageKey: obj.key, mimeType: 'text/csv', byteSize: obj.byteSize } });
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
  return { owner, projectId };
}

describe('simplified journey: cast and roundtable', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('builds markets × three income tiers, runs the roundtable and computes the report', async () => {
    const { owner, projectId } = await readyProject();
    expect(await availableMarkets(projectId)).toEqual(['Indonesia', 'Thailand']);

    await expect(requestCast(owner, projectId, 'en')).rejects.toBeInstanceOf(JourneyRefused);
    await saveStudyBrief(owner, projectId, { context: 'A Chinese beauty brand', markets: ['Indonesia', 'Thailand'], question: DEFAULT_QUESTION.en, categories: DEFAULT_CATEGORIES.en });

    const { cohortId } = await requestCast(owner, projectId, 'en');
    expect(await db.job.count({ where: { kind: 'cast' } })).toBe(1);
    const job = await db.job.findFirstOrThrow({ where: { kind: 'cast' } });
    const outcome = await executeCast(job.input as never);
    expect(outcome.status).toBe('COMPLETED');

    const cast = await latestCast(projectId);
    expect(cast!.personas).toHaveLength(6);
    const profiles = cast!.personas.map((p) => p.versions[0]!.profile as unknown as CastProfile);
    expect(profiles.map((p) => `${p.market}:${p.tier}`)).toEqual(['Indonesia:1', 'Indonesia:2', 'Indonesia:3', 'Thailand:1', 'Thailand:2', 'Thailand:3']);
    expect(profiles[0]!.bands).toContain('IDR 20 million or more');
    expect(profiles[0]!.identity?.name).toMatch(/MOCK/);
    expect(profiles[0]!.identity!.keyStatIds.length).toBeGreaterThan(0);
    // Every model call is recorded against the cast.
    expect(await db.modelCall.count({ where: { cohortId } })).toBe(6);

    await expect(requestRoundtable(owner, projectId, 'en')).rejects.toThrow(/Approve the cast/);
    await approveCast(owner, projectId, cohortId);
    const { roundtableId } = await requestRoundtable(owner, projectId, 'en');
    const rt = await executeRoundtable(roundtableId);
    expect(rt.status).toBe('COMPLETED');

    const stored = await db.roundtable.findUniqueOrThrow({ where: { id: roundtableId }, include: { answers: true } });
    expect(stored.isMock).toBe(true);
    expect(stored.answers).toHaveLength(6);
    expect(stored.answers.every((a) => a.ok && (a.scores as unknown as ScoredCategory[]).length === 8)).toBe(true);
    expect((stored.summary as { takeaways: string[] }).takeaways.length).toBeGreaterThan(0);
    // The brief the roundtable used is kept as it was; a later edit becomes version 2.
    await saveStudyBrief(owner, projectId, { context: '', markets: ['Thailand'], question: DEFAULT_QUESTION.en, categories: ['A', 'B'] });
    expect(await db.brief.count({ where: { projectId } })).toBe(2);

    const view = roundtableView(stored.categories, stored.answers.map((a) => ({ ...a, scores: a.scores as unknown as ScoredCategory[] })));
    expect(view.markets.map((m) => m.market).sort()).toEqual(['Indonesia', 'Thailand']);
    expect(view.featured.length).toBe(2);

    await saveMarketInputs(owner, projectId, [{ market: 'Indonesia', geoTrade: 70, spending: 55, digital: 80, scrutiny: 60, source: 'Team estimate' }]);
    await expect(saveMarketInputs(owner, projectId, [{ market: 'Thailand', geoTrade: 140 }])).rejects.toBeInstanceOf(JourneyRefused);
    const inputs = await marketInputs(projectId);
    const potential = potentialIndex(['Indonesia', 'Thailand'], inputs, view.markets);
    expect(potential.find((p) => p.market === 'Indonesia')!.missing).toEqual([]);
    expect(potential.find((p) => p.market === 'Thailand')!.missing).toEqual(['geoTrade', 'spending', 'digital']);
    const entry = entryIndex(['Indonesia'], stored.categories, inputs, view.markets);
    expect(entry[0]!.lead).not.toBeNull();
  });

  it('fails a cast with a stated reason when no chosen market is in the data', async () => {
    const { owner, projectId } = await readyProject();
    await saveStudyBrief(owner, projectId, { context: '', markets: ['Peru'], question: DEFAULT_QUESTION.en, categories: ['A', 'B'] });
    const { cohortId } = await requestCast(owner, projectId, 'en');
    const job = await db.job.findFirstOrThrow({ where: { kind: 'cast' } });
    const outcome = await executeCast(job.input as never);
    expect(outcome.status).toBe('FAILED');
    const c = await db.cohort.findUniqueOrThrow({ where: { id: cohortId } });
    expect(c.buildError).toMatch(/Peru/);
  });
});
