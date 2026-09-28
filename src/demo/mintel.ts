/**
 * Mintel "Global Consumer" databook adapter.
 *
 * A Mintel databook is not a data table. It is a report: fifty-odd sheets per workbook, each a
 * cross-tab with a title, the verbatim question, a base note, two rows of stacked headers, and
 * demographic breaks separated by unlabelled blank rows. The generic ingest path expects a
 * rectangular table, and correctly refuses to guess at this one.
 *
 * This module converts a workbook into the table it actually contains: one row per
 * (question × statement × response option × demographic segment), carrying the segment's own base
 * so that nothing downstream has to assume a denominator.
 *
 * What it deliberately does not do is invent respondents. Every figure here is a share of a
 * segment, published by Mintel — it is aggregate evidence, and the dataset it produces is labelled
 * as such so that no persona built from it can be described as an observation of an individual.
 *
 * The layout it relies on, from the "Qn by demographics" sheets:
 *
 *   row 1   question title
 *   row 3   question text, quoted
 *   row 5   "Base: 1,000 internet users aged…"
 *   row 7   statement, merged across that statement's response columns (blank for single-part
 *           questions, where row 7 reads "All")
 *   row 8   response options; column B is "Sample"
 *   row 9   the "All" segment
 *   row 10+ blocks of: a group name alone in column A, then that group's segments
 *
 * Anything that does not match is skipped rather than guessed at, and `warnings` says what was
 * skipped — a silent adapter that quietly drops half a workbook is worse than no adapter.
 */
import ExcelJS from 'exceljs';

export interface MintelRow {
  market: string;
  wave: string;
  wave_year: number;
  wave_month: string;
  question_id: string;
  statement: string;
  response: string;
  segment_group: string;
  segment: string;
  sample_base: number | '';
  share: number;
}

export interface MintelWorkbook {
  market: string;
  wave: string;
  rows: MintelRow[];
  /**
   * The verbatim question behind each question id.
   *
   * Kept out of the row table on purpose: repeating a 200-character question on every one of a
   * hundred thousand rows triples the file for no added information. It is published alongside as
   * its own small table, so the wording is never lost — only stored once.
   */
  questionText: Map<string, string>;
  questions: number;
  warnings: string[];
}

export const MINTEL_COLUMNS: readonly (keyof MintelRow)[] = [
  'market', 'wave', 'wave_year', 'wave_month', 'question_id', 'statement',
  'response', 'segment_group', 'segment', 'sample_base', 'share',
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Market and wave come from the filename, because the sheets themselves do not reliably carry
 * both — and a row that cannot say which market and which wave it describes is worse than absent.
 *
 * Example: "Indonesia-Global Consumer - March 2026 - The Holistic Consumer_.xlsx"
 */
export function parseFileName(fileName: string): { market: string; wave: string; month: string; year: number } | null {
  const base = fileName.replace(/\.xlsx?$/i, '').replace(/[​-‏‪-‮]/g, '');
  const dash = base.indexOf('-');
  if (dash <= 0) return null;
  const market = base.slice(0, dash).trim();
  const m = base.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/);
  if (!market || !m) return null;
  return { market, wave: `${m[1]} ${m[2]}`, month: m[1]!, year: Number(m[2]) };
}

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return String(o.result ?? '');
    if ('richText' in o) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if ('text' in o) return String(o.text ?? '');
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^["“”]|["“”]$/g, '').trim();
}

function numberOrBlank(v: ExcelJS.CellValue): number | '' {
  const t = text(v).replace(/,/g, '').trim();
  if (t === '') return '';
  const n = Number(t);
  return Number.isFinite(n) ? n : '';
}

/** `Qn by demographics` is preferred; `Qn topline` is the same data with only the "All" segment. */
function sheetsToRead(wb: ExcelJS.Workbook): { id: string; sheet: ExcelJS.Worksheet; hasDemographics: boolean }[] {
  const byId = new Map<string, { id: string; sheet: ExcelJS.Worksheet; hasDemographics: boolean }>();
  for (const ws of wb.worksheets) {
    const demo = ws.name.match(/^(Q\d+) by demographics$/i);
    const top = ws.name.match(/^(Q\d+) topline$/i);
    if (demo) byId.set(demo[1]!.toUpperCase(), { id: demo[1]!.toUpperCase(), sheet: ws, hasDemographics: true });
    else if (top && !byId.has(top[1]!.toUpperCase())) {
      byId.set(top[1]!.toUpperCase(), { id: top[1]!.toUpperCase(), sheet: ws, hasDemographics: false });
    }
  }
  return [...byId.values()].sort(
    (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)),
  );
}

/** Locate the two stacked header rows rather than assuming rows 7 and 8. */
function findHeaderRows(ws: ExcelJS.Worksheet, hasDemographics: boolean): { statementRow: number; responseRow: number } | null {
  const limit = Math.min(20, ws.rowCount);
  for (let r = 2; r <= limit; r += 1) {
    const row = ws.getRow(r);
    // The response-option row is the one whose second column reads "Sample".
    if (clean(text(row.getCell(hasDemographics ? 2 : 1).value)).toLowerCase() === 'sample') {
      return { statementRow: r - 1, responseRow: r };
    }
  }
  return null;
}

export async function readMintelWorkbook(
  filePath: string,
  fileName: string,
): Promise<MintelWorkbook | null> {
  if (!parseFileName(fileName)) return null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return mintelFromWorkbook(wb, fileName);
}

/** The same, from uploaded bytes. Returns null when the file is not a Mintel databook. */
export async function readMintelBuffer(bytes: Buffer, fileName: string): Promise<MintelWorkbook | null> {
  if (!parseFileName(fileName)) return null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  if (sheetsToRead(wb).length === 0) return null;
  return mintelFromWorkbook(wb, fileName);
}

function mintelFromWorkbook(wb: ExcelJS.Workbook, fileName: string): MintelWorkbook | null {
  const meta = parseFileName(fileName);
  if (!meta) return null;

  const rows: MintelRow[] = [];
  const questionText = new Map<string, string>();
  const warnings: string[] = [];
  const sheets = sheetsToRead(wb);

  for (const { id, sheet, hasDemographics } of sheets) {
    const header = findHeaderRows(sheet, hasDemographics);
    if (!header) {
      warnings.push(`${id}: no "Sample" header row found; sheet skipped.`);
      continue;
    }

    const title = clean(text(sheet.getRow(1).getCell(1).value));
    const question = clean(text(sheet.getRow(3).getCell(1).value)) || title;
    if (question) questionText.set(id, question);

    // Column B carries the segment base on a demographics sheet; a topline sheet has no such
    // column, so values start one column earlier.
    const firstValueCol = hasDemographics ? 3 : 2;
    const baseCol = hasDemographics ? 2 : null;

    const statements: string[] = [];
    const responses: string[] = [];
    for (let c = firstValueCol; c <= sheet.columnCount; c += 1) {
      statements[c] = clean(text(sheet.getRow(header.statementRow).getCell(c).value));
      responses[c] = clean(text(sheet.getRow(header.responseRow).getCell(c).value));
    }
    // A merged statement header only populates its first column; carry it across its own block.
    let carried = '';
    for (let c = firstValueCol; c <= sheet.columnCount; c += 1) {
      if (statements[c]) carried = statements[c]!;
      else statements[c] = carried;
    }

    let group = 'All';
    let emitted = 0;

    for (let r = header.responseRow + 1; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      const label = clean(text(row.getCell(1).value));
      if (!label) continue;
      // The boilerplate that closes every sheet.
      if (/^(source|research partner|base|note|fieldwork)\b/i.test(label)) break;

      const base = baseCol ? numberOrBlank(row.getCell(baseCol).value) : '';

      // A label with nothing beside it names the next demographic group.
      const hasValues = (() => {
        for (let c = firstValueCol; c <= sheet.columnCount; c += 1) {
          if (text(row.getCell(c).value).trim() !== '') return true;
        }
        return false;
      })();
      if (!hasValues) {
        group = label;
        continue;
      }

      const segmentGroup = label.toLowerCase() === 'all' ? 'All' : group;

      for (let c = firstValueCol; c <= sheet.columnCount; c += 1) {
        const raw = text(row.getCell(c).value).trim();
        if (raw === '') continue;
        const share = Number(raw.replace(/[%,]/g, ''));
        if (!Number.isFinite(share)) continue;
        const response = responses[c] ?? '';
        if (!response) continue;

        rows.push({
          market: meta.market,
          wave: meta.wave,
          wave_year: meta.year,
          wave_month: meta.month,
          question_id: id,
          statement: (statements[c] || title).slice(0, 300),
          response,
          segment_group: segmentGroup,
          segment: label,
          sample_base: base,
          // Mintel writes shares as proportions; express them as percentages, which is how the
          // figures are quoted in the report and read on screen.
          share: Math.round(share * 1000) / 10,
        });
        emitted += 1;
      }
    }

    if (emitted === 0) warnings.push(`${id}: header found but no data rows were read.`);
  }

  return {
    market: meta.market,
    wave: meta.wave,
    rows,
    questionText,
    questions: sheets.length,
    warnings,
  };
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly MintelRow[]): string {
  const out = [MINTEL_COLUMNS.join(',')];
  for (const r of rows) out.push(MINTEL_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return out.join('\n');
}

/**
 * Which demographic breaks the analysis table keeps.
 *
 * A databook carries every cross of every break — "Gender and age" alone is thirty-odd segments,
 * and "Living situation" and "Pet ownership" another thirty between them. Keeping all of it
 * produces roughly a million rows across a season of files for no analytical gain. These are the
 * breaks persona, trend and debate work actually reasons about.
 */
export const ANALYSIS_SEGMENT_GROUPS = new Set(
  [
    'all', 'region', 'gender', 'age groups', 'area',
    'monthly household income', 'net monthly household income', 'household income',
    'financial situation', 'employment', 'educational level', 'parental status',
  ].map((s) => s.toLowerCase()),
);

export function keepForAnalysis(row: MintelRow): boolean {
  return ANALYSIS_SEGMENT_GROUPS.has(row.segment_group.toLowerCase());
}

export function monthIndex(month: string): number {
  return MONTHS.indexOf(month);
}
