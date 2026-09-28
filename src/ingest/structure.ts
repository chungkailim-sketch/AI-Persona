/**
 * Data structuring: turning whatever was uploaded into tables that can be used as they stand.
 *
 * Parsing answers "what is in the file". Structuring answers "what table does this file actually
 * contain, and what would someone loading it into a database, a notebook or a dashboard need to know
 * about it". Two shapes of input are handled:
 *
 *  - **Report layouts** (Mintel "Global Consumer" databooks). A databook is a report, not a table:
 *    fifty-odd cross-tab sheets with stacked headers. It is flattened into one tidy long table —
 *    one row per market × wave × question × statement × response × segment, carrying the segment's
 *    own base — plus a question index holding the verbatim wording once. Every wave and market in
 *    the upload lands in the same table, so the result is longitudinal without further work.
 *  - **Ordinary tables** (CSV, or a workbook of rectangular sheets). Column names become stable
 *    snake_case identifiers, "no data" markers become blanks, and numeric columns written with
 *    thousands separators or percent signs become plain numbers. Nothing is imputed and no row is
 *    invented: a value that cannot be read as a number stays as text and the column stays text.
 *
 * Every table carries a data dictionary (name, source column, type, unit, description) and the
 * whole set is described by a Frictionless Data Package (`datapackage.json`), the open standard
 * most loaders understand. What leaves the application is filtered again at download time by the
 * field review, so a column a reviewer excluded never travels.
 */
import { MINTEL_COLUMNS, type MintelRow } from '@/demo/mintel';
import type { ParsedTable } from '@/ingest/parse';

export type StructuredKind = 'survey_long' | 'question_index' | 'tabular';

export interface StructuredColumn {
  /** Stable identifier used in the exported file. */
  name: string;
  /** The header as it appeared in the source. */
  sourceName: string;
  /** The field name used by the field review (sheet-prefixed for workbook sheets). */
  fieldName: string;
  type: 'integer' | 'number' | 'string' | 'date' | 'boolean';
  unit?: 'percent';
  description: string;
}

export interface StructuredDraft {
  name: string;
  title: string;
  kind: StructuredKind;
  sourceFiles: string[];
  columns: StructuredColumn[];
  rows: string[][];
  notes: string[];
}

const NA_MARKERS = new Set(['', '-', '–', '—', 'n/a', 'na', 'null', 'none', '#n/a', 'nan', '.', '*', 'x']);

export function isMissing(v: string): boolean {
  return NA_MARKERS.has(v.trim().toLowerCase());
}

/** `Age Group (%)` → `age_group_pct`; never empty, never starting with a digit. */
export function toIdentifier(header: string): string {
  const id = header
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/%/g, ' pct ')
    .replace(/#/g, ' num ')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  if (!id) return 'column';
  return /^[0-9]/.test(id) ? `c_${id}` : id;
}

export function uniqueIdentifiers(headers: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h) => {
    const base = toIdentifier(h).slice(0, 60);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}_${n + 1}`;
  });
}

/**
 * Read a cell as a number the way a person would: "1,234" is 1234, "45%" is 45, "(12)" stays text.
 * Returns null when the cell is not a plain number.
 */
export function readNumber(raw: string): { value: number; percent: boolean } | null {
  let t = raw.trim();
  if (t === '') return null;
  const percent = t.endsWith('%');
  if (percent) t = t.slice(0, -1).trim();
  t = t.replace(/^[$€£¥]/, '');
  // Thousands separators only in their proper places, so "1,5" (a European decimal) is not 15.
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const value = Number(t);
  return Number.isFinite(value) ? { value, percent } : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BOOLEAN = new Set(['true', 'false', 'yes', 'no', 'y', 'n']);

/** Decide a column's type from every non-missing value; one stray value keeps it as text. */
export function inferColumn(values: readonly string[]): Pick<StructuredColumn, 'type' | 'unit'> {
  const present = values.filter((v) => !isMissing(v));
  if (present.length === 0) return { type: 'string' };
  const nums = present.map(readNumber);
  if (nums.every((n) => n !== null)) {
    const percent = nums.filter((n) => n!.percent).length > present.length / 2;
    const integer = nums.every((n) => Number.isInteger(n!.value));
    return { type: integer && !percent ? 'integer' : 'number', ...(percent ? { unit: 'percent' as const } : {}) };
  }
  if (present.every((v) => ISO_DATE.test(v.trim()))) return { type: 'date' };
  if (present.every((v) => BOOLEAN.has(v.trim().toLowerCase()))) return { type: 'boolean' };
  return { type: 'string' };
}

function normaliseValue(v: string, column: Pick<StructuredColumn, 'type'>): string {
  if (isMissing(v)) return '';
  const t = v.trim();
  if (column.type === 'integer' || column.type === 'number') return String(readNumber(t)!.value);
  if (column.type === 'boolean') return ['true', 'yes', 'y'].includes(t.toLowerCase()) ? 'true' : 'false';
  return t.replace(/\s+/g, ' ');
}

/**
 * An ordinary table, made loadable: identifiers for headers, blanks for "no data" markers, plain
 * numbers where every value is a number. Empty rows and wholly empty columns are dropped and said.
 */
export function structureTabular(table: ParsedTable, fileName: string): StructuredDraft {
  const notes: string[] = [];
  const keepCols = table.headers
    .map((_, i) => i)
    .filter((i) => table.rows.some((r) => !isMissing(r[i] ?? '')));
  const droppedCols = table.headers.length - keepCols.length;
  if (droppedCols > 0) notes.push(`${droppedCols} column(s) had no values in any row and were left out.`);

  const headers = keepCols.map((i) => table.headers[i]!);
  const ids = uniqueIdentifiers(headers);
  const prefix = table.sheetName ? `${table.sheetName}/` : '';
  const columns: StructuredColumn[] = keepCols.map((i, j) => {
    const inferred = inferColumn(table.rows.map((r) => r[i] ?? ''));
    return {
      name: ids[j]!,
      sourceName: headers[j]!,
      fieldName: `${prefix}${headers[j]!.trim()}`,
      ...inferred,
      description: `"${headers[j]}" from ${fileName}${table.sheetName ? `, sheet "${table.sheetName}"` : ''}.`,
    };
  });

  const rows: string[][] = [];
  let emptyRows = 0;
  for (const r of table.rows) {
    const out = keepCols.map((i, j) => normaliseValue(r[i] ?? '', columns[j]!));
    if (out.every((v) => v === '')) { emptyRows += 1; continue; }
    rows.push(out);
  }
  if (emptyRows > 0) notes.push(`${emptyRows} empty row(s) were left out.`);
  const renamed = columns.filter((c) => c.name !== c.sourceName).length;
  if (renamed > 0) notes.push(`${renamed} column name(s) were turned into identifiers; the dictionary maps each to its source header.`);
  const converted = columns.filter((c) => c.type === 'number' || c.type === 'integer').length;
  if (converted > 0) notes.push(`${converted} numeric column(s) written as plain numbers (separators and % signs removed; unit recorded).`);
  if (table.truncated) notes.push(`The source had ${table.totalRows.toLocaleString()} rows; only those read are included.`);

  const base = toIdentifier(`${fileName.replace(/\.[^.]+$/, '')}${table.sheetName ? `_${table.sheetName}` : ''}`);
  return {
    name: base.slice(0, 80),
    title: `${fileName}${table.sheetName ? ` — ${table.sheetName}` : ''}`,
    kind: 'tabular',
    sourceFiles: [fileName],
    columns,
    rows,
    notes,
  };
}

const LONG_DESCRIPTIONS: Record<(typeof MINTEL_COLUMNS)[number], Omit<StructuredColumn, 'name' | 'sourceName' | 'fieldName'>> = {
  market: { type: 'string', description: 'Market the wave was fielded in, from the databook filename.' },
  wave: { type: 'string', description: 'Fieldwork wave, e.g. "March 2026".' },
  wave_year: { type: 'integer', description: 'Year of the wave.' },
  wave_month: { type: 'string', description: 'Month of the wave.' },
  question_id: { type: 'string', description: 'Question identifier (Q1, Q2 …). Wording is in the question index.' },
  statement: { type: 'string', description: 'Statement or sub-question the response belongs to.' },
  response: { type: 'string', description: 'Response option.' },
  segment_group: { type: 'string', description: 'Demographic break (e.g. "Age groups"); "All" for the total.' },
  segment: { type: 'string', description: 'Segment within the break (e.g. "25-34").' },
  sample_base: { type: 'integer', description: 'Respondents in the segment (the base the share is of). Blank on topline-only sheets.' },
  share: { type: 'number', unit: 'percent', description: 'Share of the segment giving this response, in percent. Published aggregate, not a respondent record.' },
};

/** The flattened long table from one or more Mintel databooks. */
export function structureSurveyLong(rows: readonly MintelRow[], sourceFiles: string[], notes: string[]): StructuredDraft {
  const sorted = [...rows].sort(
    (a, b) =>
      a.market.localeCompare(b.market) ||
      a.wave_year - b.wave_year ||
      MONTHS.indexOf(a.wave_month) - MONTHS.indexOf(b.wave_month) ||
      Number(a.question_id.slice(1)) - Number(b.question_id.slice(1)),
  );
  const markets = [...new Set(sorted.map((r) => r.market))];
  const waves = [...new Set(sorted.map((r) => r.wave))];
  return {
    name: 'survey_responses',
    title: `Survey responses — ${markets.join(', ')} (${waves.length} wave${waves.length === 1 ? '' : 's'})`,
    kind: 'survey_long',
    sourceFiles,
    columns: MINTEL_COLUMNS.map((c) => ({ name: c, sourceName: c, fieldName: c, ...LONG_DESCRIPTIONS[c] })),
    rows: sorted.map((r) => MINTEL_COLUMNS.map((c) => String(r[c]))),
    notes,
  };
}

/** The verbatim question wording, stored once rather than on every row. */
export function structureQuestionIndex(
  index: Map<string, { question: string; markets: Set<string>; waves: Set<string> }>,
  sourceFiles: string[],
): StructuredDraft {
  const ids = [...index.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const cols: [string, StructuredColumn['type'], string][] = [
    ['question_id', 'string', 'Question identifier, joins to survey_responses.question_id.'],
    ['question_text', 'string', 'Verbatim question wording from the databook.'],
    ['markets', 'string', 'Markets the question was asked in, separated by "; ".'],
    ['waves', 'string', 'Waves the question was asked in, separated by "; ".'],
  ];
  return {
    name: 'question_index',
    title: 'Question index',
    kind: 'question_index',
    sourceFiles,
    columns: cols.map(([name, type, description]) => ({ name, sourceName: name, fieldName: `question_index/${name}`, type, description })),
    rows: ids.map((id) => {
      const q = index.get(id)!;
      return [id, q.question, [...q.markets].sort().join('; '), [...q.waves].join('; ')];
    }),
    notes: [],
  };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** RFC 4180 CSV with a header row. `keep` limits the output to the named columns. */
export function draftToCsv(draft: Pick<StructuredDraft, 'columns' | 'rows'>, keep?: ReadonlySet<string>): string {
  const idx = draft.columns.map((c, i) => (!keep || keep.has(c.name) ? i : -1)).filter((i) => i >= 0);
  const out = [idx.map((i) => draft.columns[i]!.name).join(',')];
  for (const r of draft.rows) out.push(idx.map((i) => csvCell(r[i] ?? '')).join(','));
  return out.join('\n') + '\n';
}

/**
 * A Frictionless Data Package descriptor (https://specs.frictionlessdata.io/data-package/) for the
 * structured tables, so the set loads into anything that reads the standard with types intact.
 */
export function dataPackage(input: {
  name: string;
  title: string;
  version: number;
  tables: { name: string; title: string; kind: string; rowCount: number; columns: StructuredColumn[] }[];
  sources: string[];
  created: Date;
}): Record<string, unknown> {
  return {
    profile: 'tabular-data-package',
    name: toIdentifier(input.name).replace(/_/g, '-'),
    title: input.title,
    version: String(input.version),
    created: input.created.toISOString(),
    sources: input.sources.map((s) => ({ title: s })),
    resources: input.tables.map((t) => ({
      profile: 'tabular-data-resource',
      name: t.name.replace(/_/g, '-'),
      path: `${t.name}.csv`,
      title: t.title,
      format: 'csv',
      mediatype: 'text/csv',
      encoding: 'utf-8',
      'x-kind': t.kind,
      'x-rowCount': t.rowCount,
      schema: {
        fields: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          description: c.description,
          ...(c.sourceName !== c.name ? { 'x-sourceName': c.sourceName } : {}),
          ...(c.unit ? { 'x-unit': c.unit } : {}),
        })),
        missingValues: [''],
      },
    })),
  };
}
