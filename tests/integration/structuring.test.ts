// @vitest-environment node
/**
 * The structuring stage end to end: a Mintel-style databook and an ordinary CSV go through the real
 * ingestion pipeline, and what comes out is a typed, downloadable table that the analysis reads.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER = 'test-pepper';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { createHash, randomUUID } from 'node:crypto';
import { db, resetDatabase, seedUser } from './helpers';
import { setStorageAdapter, type StorageAdapter, type StoredObject } from '../../src/storage/adapter';
import { runIngest } from '../../src/ingest/pipeline';
import { exportDataPackage, exportStructuredCsv, readVersionTables, structuredTablesView } from '../../src/ingest/structured';
import { isLongSurveyTable } from '../../src/forecast/series';

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
  async remove(key: string): Promise<void> {
    this.files.delete(key);
  }
}
const store = new MemoryStore();
setStorageAdapter(store);

/** A databook in the shape Mintel publishes: title, quoted question, stacked headers, demographic blocks. */
async function databook(shares: { all: number[]; young: number[]; older: number[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Contents').getCell('A1').value = 'Contents';
  const ws = wb.addWorksheet('Q1 by demographics');
  ws.getCell('A1').value = 'Q1. Attitudes to AI advertising';
  ws.getCell('A3').value = '"Which of the following statements do you agree with?"';
  ws.getCell('A5').value = 'Base: 1,000 internet users aged 16+';
  ws.getCell('C7').value = 'I trust ads shown by AI assistants';
  ws.getCell('E7').value = 'AI assistants favour sponsored products';
  ws.getRow(8).values = ['', 'Sample', 'Agree', 'Disagree', 'Agree', 'Disagree'];
  ws.getRow(9).values = ['All', 1000, ...shares.all];
  ws.getRow(10).values = ['Age groups'];
  ws.getRow(11).values = ['16-24', 180, ...shares.young];
  ws.getRow(12).values = ['25-34', 220, ...shares.older];
  ws.getRow(13).values = ['Gender and age'];
  ws.getRow(14).values = ['Male 16-24', 90, 0.4, 0.6, 0.5, 0.5];
  ws.getRow(16).values = ['Source: Kantar Profiles/Mintel'];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function makeVersion(files: { name: string; bytes: Buffer }[]) {
  const user = await seedUser(`structure-${randomUUID().slice(0, 8)}@example.com`);
  const workspace = await db.workspace.create({ data: { name: 'Test workspace' } });
  const dataset = await db.dataset.create({ data: { workspaceId: workspace.id, name: 'Mintel — China', createdById: user.id } });
  const version = await db.datasetVersion.create({ data: { datasetId: dataset.id, versionNo: 1, status: 'UPLOADING', createdById: user.id } });
  // Linked to a project so the pipeline's telemetry is recorded.
  const project = await db.project.create({ data: { workspaceId: workspace.id, name: 'Structuring', createdById: user.id } });
  await db.projectDataset.create({ data: { projectId: project.id, datasetId: dataset.id } });
  for (const f of files) {
    const obj = await store.put('test', f.bytes);
    await db.sourceFile.create({
      data: { datasetVersionId: version.id, originalName: f.name, storageKey: obj.key, mimeType: 'application/octet-stream', byteSize: obj.byteSize },
    });
  }
  return version.id;
}

describe('data structuring', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('flattens databooks from two waves into one long table plus a question index', async () => {
    const versionId = await makeVersion([
      { name: 'China-Global Consumer - March 2025 - The Holistic Consumer_.xlsx', bytes: await databook({ all: [0.3, 0.7, 0.5, 0.5], young: [0.42, 0.58, 0.61, 0.39], older: [0.35, 0.65, 0.55, 0.45] }) },
      { name: 'China-Global Consumer - March 2026 - The Holistic Consumer_.xlsx', bytes: await databook({ all: [0.34, 0.66, 0.52, 0.48], young: [0.47, 0.53, 0.64, 0.36], older: [0.36, 0.64, 0.57, 0.43] }) },
    ]);
    const outcome = await runIngest(versionId);
    expect(outcome.status).toBe('READY_FOR_REVIEW');

    const tables = await structuredTablesView(versionId);
    expect(tables.map((t) => t.kind)).toEqual(['survey_long', 'question_index']);
    const long = tables[0]!;
    expect(long.isPrimary).toBe(true);
    // 2 waves × 3 segments × 4 cells; the "Gender and age" cross is outside the analysis breaks.
    expect(long.rowCount).toBe(24);
    expect(long.notes.join(' ')).toMatch(/left out/);
    expect(long.preview[0]).toEqual(['China', 'March 2025', '2025', 'March', 'Q1', 'I trust ads shown by AI assistants', 'Agree', 'All', 'All', '1000', '30']);
    expect(tables[1]!.preview[0]).toEqual(['Q1', 'Which of the following statements do you agree with?', 'China', 'March 2025; March 2026']);

    // The field review sees the tidy columns, not fifty sheets of stacked headers.
    const fields = await db.datasetField.findMany({ where: { datasetVersionId: versionId }, select: { name: true } });
    expect(fields.map((f) => f.name).sort()).toEqual(['market', 'question_id', 'response', 'sample_base', 'segment', 'segment_group', 'share', 'statement', 'wave', 'wave_month', 'wave_year'].sort());

    // Analysis reads the same table the person can download.
    const read = await readVersionTables(versionId);
    expect(read).toHaveLength(1);
    expect(isLongSurveyTable(read[0]!.headers)).toBe(true);
    expect(read[0]!.rows).toHaveLength(24);

    const events = await db.telemetryEvent.findMany({ where: { datasetVersionId: versionId, stage: 'data_structuring' } });
    expect(events.some((e) => e.status === 'completed')).toBe(true);
  });

  it('withholds a column excluded in the field review from every export', async () => {
    const csv = ['Respondent Email,Age Band,Trust Score', 'a@x.com,18-24,4', 'b@x.com,25-34,"1,200"'].join('\n');
    const versionId = await makeVersion([{ name: 'panel.csv', bytes: Buffer.from(csv, 'utf8') }]);
    await runIngest(versionId);

    const email = await db.datasetField.findFirstOrThrow({ where: { datasetVersionId: versionId, name: 'Respondent Email' } });
    expect(email.excluded).toBe(true);

    const [t] = await structuredTablesView(versionId);
    expect(t!.withheld).toEqual(['respondent_email']);
    expect(t!.columns.map((c) => c.name)).toEqual(['age_band', 'trust_score']);
    expect(t!.preview).toEqual([['18-24', '4'], ['25-34', '1200']]);

    const out = await exportStructuredCsv(versionId, t!.id);
    expect(out!.csv).toBe('age_band,trust_score\n18-24,4\n25-34,1200\n');
    const pkg = (await exportDataPackage(versionId)) as { resources: { schema: { fields: { name: string }[] } }[] };
    expect(pkg.resources[0]!.schema.fields.map((f) => f.name)).toEqual(['age_band', 'trust_score']);
  });
});
