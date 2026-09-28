// @vitest-environment node
/**
 * The ingestion pipeline end to end, against a real database and a real object store.
 *
 * The properties under test are the ones that would be invisible in a unit test: that flagged
 * fields land in the database excluded, that a blocking finding actually blocks, and that a dataset
 * cannot become usable without a person having recorded provenance and permitted model processing.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER = 'test-pepper';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, resetDatabase, seedUser } from './helpers';
import { setStorageAdapter, type StorageAdapter, type StoredObject } from '../../src/storage/adapter';
import { runIngest, assessUsability } from '../../src/ingest/pipeline';
import { createHash, randomUUID } from 'node:crypto';

/** In-memory store, so the test never touches the filesystem. */
class MemoryStore implements StorageAdapter {
  readonly name = 'memory';
  private readonly files = new Map<string, Buffer>();
  async put(prefix: string, bytes: Buffer): Promise<StoredObject> {
    const key = `${prefix}/${randomUUID()}`;
    this.files.set(key, bytes);
    return {
      key,
      byteSize: bytes.byteLength,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  async get(key: string): Promise<Buffer> {
    const b = this.files.get(key);
    if (!b) throw new Error('missing');
    return b;
  }
  async remove(key: string): Promise<void> {
    this.files.delete(key);
  }
}

const store = new MemoryStore();
setStorageAdapter(store);

async function makeVersion(files: { name: string; content: string }[]) {
  const user = await seedUser(`ingest-${randomUUID().slice(0, 8)}@example.com`);
  const workspace = await db.workspace.create({ data: { name: 'Test workspace' } });
  const dataset = await db.dataset.create({
    data: { workspaceId: workspace.id, name: 'Test dataset', createdById: user.id },
  });
  const version = await db.datasetVersion.create({
    data: { datasetId: dataset.id, versionNo: 1, status: 'UPLOADING', createdById: user.id },
  });
  for (const f of files) {
    const obj = await store.put('test', Buffer.from(f.content, 'utf8'));
    await db.sourceFile.create({
      data: {
        datasetVersionId: version.id,
        originalName: f.name,
        storageKey: obj.key,
        mimeType: 'text/csv',
        byteSize: obj.byteSize,
      },
    });
  }
  return { userId: user.id, datasetId: dataset.id, versionId: version.id };
}

const CLEAN_CSV = [
  'market,age_band,purchase_intent,brand_awareness',
  'Indonesia,25-34,4,3',
  'Indonesia,35-44,5,4',
  'Germany,25-34,2,3',
  'Germany,35-44,3,2',
  'Mexico,25-34,4,4',
  'Mexico,35-44,5,5',
].join('\n');

describe('ingestion', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('parses, profiles and stops at review rather than importing itself', async () => {
    const { versionId } = await makeVersion([{ name: 'survey.csv', content: CLEAN_CSV }]);
    const outcome = await runIngest(versionId);

    expect(outcome.status).toBe('READY_FOR_REVIEW');
    expect(outcome.rowCount).toBe(6);
    expect(outcome.fieldCount).toBe(4);

    const version = await db.datasetVersion.findUniqueOrThrow({ where: { id: versionId } });
    // Never IMPORTED on its own: a person has to clear it.
    expect(version.status).toBe('READY_FOR_REVIEW');
    expect(version.checksum).toHaveLength(64);
    expect(version.qualityScore).toBeGreaterThan(0);
  });

  it('records a content hash that changes with the content', async () => {
    const a = await makeVersion([{ name: 'a.csv', content: CLEAN_CSV }]);
    const b = await makeVersion([{ name: 'b.csv', content: `${CLEAN_CSV}\nMexico,45-54,1,1` }]);
    await runIngest(a.versionId);
    await runIngest(b.versionId);

    const [va, vb] = await Promise.all([
      db.datasetVersion.findUniqueOrThrow({ where: { id: a.versionId } }),
      db.datasetVersion.findUniqueOrThrow({ where: { id: b.versionId } }),
    ]);
    expect(va.checksum).not.toBe(vb.checksum);
  });

  it('excludes detected sensitive fields by default', async () => {
    const csv = [
      'email,market,purchase_intent',
      'ada@example.com,Indonesia,4',
      'bob@example.com,Germany,2',
    ].join('\n');
    const { versionId } = await makeVersion([{ name: 'panel.csv', content: csv }]);
    await runIngest(versionId);

    const fields = await db.datasetField.findMany({ where: { datasetVersionId: versionId } });
    const email = fields.find((f) => f.name === 'email');
    expect(email?.sensitivity).toBe('PII');
    // The default that matters.
    expect(email?.excluded).toBe(true);
    expect(email?.sensitivityReason).toBeTruthy();

    const market = fields.find((f) => f.name === 'market');
    expect(market?.sensitivity).toBe('NONE');
    expect(market?.excluded).toBe(false);
  });

  it('writes integrity findings and a quality breakdown, not just a score', async () => {
    const csv = ['market,empty_col', 'Indonesia,', 'Germany,'].join('\n');
    const { versionId } = await makeVersion([
      { name: 'Mintel_Germany_Q1_2026.csv', content: `Country: Indonesia\n${csv}` },
    ]);
    await runIngest(versionId);

    const findings = await db.integrityFinding.findMany({ where: { datasetVersionId: versionId } });
    expect(findings.length).toBeGreaterThan(0);

    const components = await db.qualityComponent.findMany({
      where: { datasetVersionId: versionId },
    });
    expect(components).toHaveLength(5);
    for (const c of components) expect(c.explanation.length).toBeGreaterThan(10);
  });

  it('creates one evidence chunk per field, so a finding has something to cite', async () => {
    const { versionId } = await makeVersion([{ name: 'survey.csv', content: CLEAN_CSV }]);
    await runIngest(versionId);
    const chunks = await db.evidenceChunk.findMany({ where: { datasetVersionId: versionId } });
    expect(chunks).toHaveLength(4);
    for (const c of chunks) {
      expect(c.locatorType).toBe('field');
      expect(c.locator).toContain('survey.csv');
    }
  });

  it('is re-runnable without duplicating fields or findings', async () => {
    const { versionId } = await makeVersion([{ name: 'survey.csv', content: CLEAN_CSV }]);
    await runIngest(versionId);
    await runIngest(versionId);
    expect(await db.datasetField.count({ where: { datasetVersionId: versionId } })).toBe(4);
  });

  it('fails cleanly when there is nothing to parse', async () => {
    const user = await seedUser('nofiles@example.com');
    const workspace = await db.workspace.create({ data: { name: 'W' } });
    const dataset = await db.dataset.create({
      data: { workspaceId: workspace.id, name: 'Empty', createdById: user.id },
    });
    const version = await db.datasetVersion.create({
      data: { datasetId: dataset.id, versionNo: 1, createdById: user.id },
    });

    await expect(runIngest(version.id)).rejects.toThrow(/no files/i);
    const after = await db.datasetVersion.findUniqueOrThrow({ where: { id: version.id } });
    expect(after.status).toBe('FAILED');
  });
});

describe('usability gate', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('refuses a freshly ingested dataset and says exactly what is missing', async () => {
    const { versionId } = await makeVersion([{ name: 'survey.csv', content: CLEAN_CSV }]);
    await runIngest(versionId);

    const verdict = await assessUsability(versionId);
    expect(verdict.usable).toBe(false);
    expect(verdict.blockers.join(' ')).toMatch(/no governance record/i);
  });

  it('still refuses once provenance exists but model processing has not been permitted', async () => {
    const { versionId, userId } = await makeVersion([{ name: 'survey.csv', content: CLEAN_CSV }]);
    await runIngest(versionId);

    await db.governanceRecord.create({
      data: {
        datasetVersionId: versionId,
        dataOwner: 'Research',
        sourceName: 'Panel',
        methodology: 'Online panel, quota sampled, weighted to census.',
        lawfulBasis: 'CONSENT',
        classification: 'CLIENT_CONFIDENTIAL',
        permittedUses: ['internal_analysis'],
        retentionDays: 90,
        sensitiveConfirmed: true,
        confirmedById: userId,
        confirmedAt: new Date(),
        // Left at its default of false.
      },
    });

    const verdict = await assessUsability(versionId);
    expect(verdict.usable).toBe(false);
    expect(verdict.blockers.join(' ')).toMatch(/model processing has not been permitted/i);
  });

  it('passes only when every condition is met', async () => {
    const { versionId, userId } = await makeVersion([{ name: 'survey.csv', content: CLEAN_CSV }]);
    await runIngest(versionId);
    await db.integrityFinding.updateMany({
      where: { datasetVersionId: versionId },
      data: { acknowledgedAt: new Date(), acknowledgedBy: userId },
    });
    await db.governanceRecord.create({
      data: {
        datasetVersionId: versionId,
        dataOwner: 'Research',
        sourceName: 'Panel',
        methodology: 'Online panel, quota sampled, weighted to census.',
        lawfulBasis: 'CONSENT',
        classification: 'CLIENT_CONFIDENTIAL',
        permittedUses: ['internal_analysis'],
        retentionDays: 90,
        sensitiveConfirmed: true,
        confirmedById: userId,
        confirmedAt: new Date(),
        allowModelProcessing: true,
      },
    });

    const verdict = await assessUsability(versionId);
    expect(verdict.blockers).toEqual([]);
    expect(verdict.usable).toBe(true);
  });

  it('refuses again once the retention period has expired', async () => {
    const { versionId, userId } = await makeVersion([{ name: 'survey.csv', content: CLEAN_CSV }]);
    await runIngest(versionId);
    await db.integrityFinding.updateMany({
      where: { datasetVersionId: versionId },
      data: { acknowledgedAt: new Date(), acknowledgedBy: userId },
    });
    await db.governanceRecord.create({
      data: {
        datasetVersionId: versionId,
        dataOwner: 'Research',
        sourceName: 'Panel',
        methodology: 'Online panel, quota sampled, weighted to census.',
        lawfulBasis: 'CONSENT',
        classification: 'CLIENT_CONFIDENTIAL',
        permittedUses: ['internal_analysis'],
        retentionDays: 1,
        expiresAt: new Date(Date.now() - 1000),
        sensitiveConfirmed: true,
        confirmedById: userId,
        confirmedAt: new Date(),
        allowModelProcessing: true,
      },
    });

    const verdict = await assessUsability(versionId);
    expect(verdict.usable).toBe(false);
    expect(verdict.blockers.join(' ')).toMatch(/retention period.*expired/i);
  });

  it('refuses when a sensitive field is included with no written justification', async () => {
    const csv = ['email,market,intent', 'a@b.com,Indonesia,4', 'c@d.com,Germany,2'].join('\n');
    const { versionId, userId } = await makeVersion([{ name: 'panel.csv', content: csv }]);
    await runIngest(versionId);
    await db.integrityFinding.updateMany({
      where: { datasetVersionId: versionId },
      data: { acknowledgedAt: new Date(), acknowledgedBy: userId },
    });
    await db.datasetField.updateMany({
      where: { datasetVersionId: versionId, name: 'email' },
      data: { excluded: false, inclusionJustification: null },
    });
    await db.governanceRecord.create({
      data: {
        datasetVersionId: versionId,
        dataOwner: 'Research',
        sourceName: 'Panel',
        methodology: 'Online panel, quota sampled, weighted to census.',
        lawfulBasis: 'CONSENT',
        classification: 'CLIENT_CONFIDENTIAL',
        permittedUses: ['internal_analysis'],
        retentionDays: 90,
        sensitiveConfirmed: true,
        confirmedById: userId,
        confirmedAt: new Date(),
        allowModelProcessing: true,
      },
    });

    const verdict = await assessUsability(versionId);
    expect(verdict.usable).toBe(false);
    expect(verdict.blockers.join(' ')).toMatch(/without a written justification/i);
  });
});
