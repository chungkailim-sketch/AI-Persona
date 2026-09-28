/**
 * Structured tables: storing them, reading them back, and exporting them (server only).
 *
 * Downstream analysis — trends, the population sample, the swarm debate — reads the structured
 * primary table when one exists, and falls back to the source files only for versions ingested
 * before structuring did. That keeps one reading of the data in use everywhere: the table a person
 * can download is the table the analysis ran on.
 */
import { prisma } from '@/lib/prisma';
import { storage } from '@/storage/adapter';
import { parseCsv, parseFile, type ParsedTable } from '@/ingest/parse';
import { kindFromName } from '@/ingest/limits';
import { dataPackage, draftToCsv, type StructuredColumn, type StructuredDraft } from '@/ingest/structure';

const PREVIEW_ROWS = 8;
/** Structured tables are ours, already bounded by the upload limits; read them back whole. */
const STRUCTURED_READ_CAP = 2_000_000;

export interface StructuredSummary {
  id: string;
  name: string;
  title: string;
  rowCount: number;
  columnCount: number;
  isPrimary: boolean;
}

/** Choose the table analysis should read: the flattened survey table, else the largest table. */
function primaryIndex(drafts: readonly StructuredDraft[]): number {
  const long = drafts.findIndex((d) => d.kind === 'survey_long');
  if (long >= 0) return long;
  let best = -1;
  drafts.forEach((d, i) => {
    if (d.kind === 'tabular' && (best < 0 || d.rows.length > drafts[best]!.rows.length)) best = i;
  });
  return best;
}

export async function persistStructuredTables(
  datasetVersionId: string,
  drafts: readonly StructuredDraft[],
): Promise<StructuredSummary[]> {
  const previous = await prisma.structuredTable.findMany({ where: { datasetVersionId }, select: { storageKey: true } });
  await prisma.structuredTable.deleteMany({ where: { datasetVersionId } });
  for (const p of previous) await storage().remove(p.storageKey).catch(() => undefined);

  const primary = primaryIndex(drafts);
  const used = new Set<string>();
  const out: StructuredSummary[] = [];
  for (const [i, d] of drafts.entries()) {
    let name = d.name;
    for (let n = 2; used.has(name); n += 1) name = `${d.name}_${n}`;
    used.add(name);
    const bytes = Buffer.from(draftToCsv(d), 'utf8');
    const stored = await storage().put(`structured/${datasetVersionId}`, bytes);
    const row = await prisma.structuredTable.create({
      data: {
        datasetVersionId,
        name,
        title: d.title,
        kind: d.kind,
        isPrimary: i === primary,
        storageKey: stored.key,
        byteSize: stored.byteSize,
        rowCount: d.rows.length,
        columns: d.columns as unknown as object,
        preview: d.rows.slice(0, PREVIEW_ROWS) as unknown as object,
        sourceFiles: d.sourceFiles,
        notes: d.notes,
      },
    });
    out.push({ id: row.id, name, title: d.title, rowCount: d.rows.length, columnCount: d.columns.length, isPrimary: row.isPrimary });
  }
  return out;
}

/**
 * The tables of a dataset version, as analysis should read them.
 *
 * The structured primary table when there is one; otherwise every table in the source files, parsed
 * the way ingestion parsed them.
 */
export async function readVersionTables(datasetVersionId: string): Promise<ParsedTable[]> {
  const primary = await prisma.structuredTable.findFirst({ where: { datasetVersionId, isPrimary: true } });
  if (primary) {
    const table = parseCsv((await storage().get(primary.storageKey)).toString('utf8'), { maxRows: STRUCTURED_READ_CAP });
    return [{ ...table, sheetName: null }];
  }
  const version = await prisma.datasetVersion.findUnique({ where: { id: datasetVersionId }, include: { files: true } });
  if (!version) return [];
  const tables: ParsedTable[] = [];
  for (const f of version.files) {
    const parsed = await parseFile(await storage().get(f.storageKey), kindFromName(f.originalName) ?? 'csv');
    tables.push(...parsed.tables);
  }
  return tables;
}

/**
 * Columns a reviewer excluded or redacted never leave in an export. A column with no reviewed
 * field behind it (the question index) carries only question wording and is kept.
 */
async function releasableColumns(datasetVersionId: string, columns: StructuredColumn[]): Promise<{ keep: Set<string>; withheld: string[] }> {
  const fields = await prisma.datasetField.findMany({
    where: { datasetVersionId },
    select: { name: true, excluded: true, redacted: true },
  });
  const byName = new Map(fields.map((f) => [f.name.trim().toLowerCase(), f]));
  const keep = new Set<string>();
  const withheld: string[] = [];
  for (const c of columns) {
    const f = byName.get(c.fieldName.trim().toLowerCase());
    if (f && (f.excluded || f.redacted)) withheld.push(c.name);
    else keep.add(c.name);
  }
  return { keep, withheld };
}

export async function exportStructuredCsv(datasetVersionId: string, tableId: string): Promise<{ fileName: string; csv: string; withheld: string[] } | null> {
  const t = await prisma.structuredTable.findFirst({ where: { id: tableId, datasetVersionId } });
  if (!t) return null;
  const columns = t.columns as unknown as StructuredColumn[];
  const { keep, withheld } = await releasableColumns(datasetVersionId, columns);
  const raw = (await storage().get(t.storageKey)).toString('utf8');
  if (withheld.length === 0) return { fileName: `${t.name}.csv`, csv: raw, withheld };
  // The stored file was written from these columns, in this order.
  const table = parseCsv(raw, { maxRows: STRUCTURED_READ_CAP });
  return { fileName: `${t.name}.csv`, csv: draftToCsv({ columns, rows: table.rows }, keep), withheld };
}

export async function exportDataPackage(datasetVersionId: string): Promise<Record<string, unknown> | null> {
  const version = await prisma.datasetVersion.findUnique({
    where: { id: datasetVersionId },
    include: { dataset: true, structured: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] }, governance: true },
  });
  if (!version || version.structured.length === 0) return null;
  const tables = await Promise.all(
    version.structured.map(async (t) => {
      const columns = t.columns as unknown as StructuredColumn[];
      const { keep } = await releasableColumns(datasetVersionId, columns);
      return { name: t.name, title: t.title, kind: t.kind, rowCount: t.rowCount, columns: columns.filter((c) => keep.has(c.name)) };
    }),
  );
  const pkg = dataPackage({
    name: version.dataset.name,
    title: version.dataset.name,
    version: version.versionNo,
    tables,
    sources: [...new Set(version.structured.flatMap((t) => t.sourceFiles))],
    created: version.createdAt,
  });
  if (version.governance) {
    pkg['x-provenance'] = {
      dataOwner: version.governance.dataOwner,
      source: version.governance.sourceName,
      methodology: version.governance.methodology,
      classification: version.governance.classification,
      permittedUses: version.governance.permittedUses,
    };
  }
  return pkg;
}

export interface StructuredTableView {
  id: string;
  name: string;
  title: string;
  kind: string;
  isPrimary: boolean;
  rowCount: number;
  byteSize: number;
  columns: StructuredColumn[];
  withheld: string[];
  preview: string[][];
  sourceFiles: string[];
  notes: string[];
}

/** What the data step shows: every table, its dictionary and a preview, with withheld columns removed. */
export async function structuredTablesView(datasetVersionId: string): Promise<StructuredTableView[]> {
  const tables = await prisma.structuredTable.findMany({
    where: { datasetVersionId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
  return Promise.all(
    tables.map(async (t) => {
      const all = t.columns as unknown as StructuredColumn[];
      const { keep, withheld } = await releasableColumns(datasetVersionId, all);
      const idx = all.map((c, i) => (keep.has(c.name) ? i : -1)).filter((i) => i >= 0);
      return {
        id: t.id,
        name: t.name,
        title: t.title,
        kind: t.kind,
        isPrimary: t.isPrimary,
        rowCount: t.rowCount,
        byteSize: t.byteSize,
        columns: idx.map((i) => all[i]!),
        withheld,
        preview: (t.preview as unknown as string[][]).map((r) => idx.map((i) => r[i] ?? '')),
        sourceFiles: t.sourceFiles,
        notes: t.notes,
      };
    }),
  );
}
