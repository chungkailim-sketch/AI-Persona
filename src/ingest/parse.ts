/**
 * Parsing uploaded tabular files.
 *
 * Everything that comes out of here is **untrusted content** (prompt §20). A cell may contain text
 * that reads like an instruction; it is data, and nothing downstream may treat it otherwise. Two
 * consequences are enforced at this layer rather than left to discipline:
 *
 *  1. Cell values are truncated to a hard character limit. A 2MB "cell" is not a data point; it is
 *     either a malformed file or an attempt to flood a prompt.
 *  2. Formula results are read as values and formulas themselves are discarded. A spreadsheet
 *     formula is executable content, and none of it is retained.
 *
 * CSV is parsed here rather than with a dependency: the grammar is small, the edge cases that
 * matter (quoted delimiters, embedded newlines, escaped quotes, BOM) are few, and a parser written
 * in the open is easier to reason about than a transitive one.
 */
import ExcelJS from 'exceljs';
import { UPLOAD_LIMITS } from '@/ingest/limits';

export interface ParsedTable {
  /** Sheet name for a workbook; null for a single CSV. */
  sheetName: string | null;
  headers: string[];
  rows: string[][];
  /**
   * Rows found ABOVE the header — captions such as "Country: Indonesia" or "Wave: Q1 2026" that
   * supplier exports routinely put at the top of a sheet. They are not data, but they are the only
   * place the file states what it actually contains, so the integrity checks compare them against
   * the filename.
   */
  preamble: string[];
  /** Rows present in the source, which may exceed `rows.length` when the cap was hit. */
  totalRows: number;
  truncated: boolean;
  notes: string[];
}

export interface ParseResult {
  tables: ParsedTable[];
  encoding: string;
  notes: string[];
}

function clampCell(v: string): string {
  return v.length > UPLOAD_LIMITS.maxCellChars ? v.slice(0, UPLOAD_LIMITS.maxCellChars) : v;
}

/** Strips a UTF-8 byte-order mark, which otherwise becomes part of the first header name. */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Find the row that is actually the header.
 *
 * Assuming row 0 is the header is wrong for a large share of real exports, which open with one to
 * five caption rows. Taking a caption as the header collapses the whole file into a single column,
 * and the damage is quiet: the dataset ingests "successfully" with one field and nobody notices
 * until the analysis makes no sense.
 *
 * The heuristic: the header is the first row whose populated width matches the width most of the
 * body uses, and whose cells are distinct. A caption is narrow; a header is as wide as the data.
 */
export function findHeaderRow(rows: string[][], lookahead = 12): number {
  if (rows.length === 0) return 0;

  const widths = rows
    .slice(0, Math.min(rows.length, 200))
    .map((r) => r.filter((c) => c.trim() !== '').length)
    .filter((w) => w > 0);
  if (widths.length === 0) return 0;

  // The modal width, which the body of a well-formed table shares.
  const counts = new Map<number, number>();
  for (const w of widths) counts.set(w, (counts.get(w) ?? 0) + 1);
  let bodyWidth = 0;
  let best = -1;
  for (const [w, c] of counts) {
    if (c > best || (c === best && w > bodyWidth)) { best = c; bodyWidth = w; }
  }
  if (bodyWidth <= 1) return 0;

  const limit = Math.min(rows.length, lookahead);
  for (let i = 0; i < limit; i += 1) {
    const row = rows[i] ?? [];
    const populated = row.filter((c) => c.trim() !== '');
    if (populated.length < Math.max(2, bodyWidth - 1)) continue;
    // A header names things once. Repeated labels mean this is a data row that happens to be wide.
    const distinct = new Set(populated.map((c) => c.trim().toLowerCase())).size;
    if (distinct < populated.length * 0.9) continue;
    return i;
  }
  return 0;
}

function detectDelimiter(firstLine: string): string {
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = -1;
  for (const c of candidates) {
    // Count only outside quotes, so a comma inside "Jakarta, Indonesia" does not win.
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i += 1) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === c) count += 1;
    }
    if (count > bestCount) { bestCount = count; best = c; }
  }
  return best;
}

export function parseCsv(text: string, opts: { maxRows?: number } = {}): ParsedTable {
  const maxRows = opts.maxRows ?? UPLOAD_LIMITS.maxRows;
  const notes: string[] = [];
  const src = stripBom(text);
  const firstNewline = src.indexOf('\n');
  const delimiter = detectDelimiter(firstNewline === -1 ? src : src.slice(0, firstNewline));
  if (delimiter !== ',') notes.push(`Delimiter detected as "${delimiter === '\t' ? 'tab' : delimiter}".`);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i] as string;

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === delimiter) { row.push(clampCell(field)); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') {
      row.push(clampCell(field));
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) { row.push(clampCell(field)); rows.push(row); }

  if (inQuotes) notes.push('The file ended inside a quoted value; the last row may be incomplete.');

  const headerIndex = findHeaderRow(rows);
  const preamble = rows
    .slice(0, headerIndex)
    .flatMap((r) => r.filter((c) => c.trim() !== ''));
  if (headerIndex > 0) {
    notes.push(
      `${headerIndex} row(s) above the header were read as captions, not data: ` +
        `${preamble.slice(0, 4).join(' | ')}`,
    );
  }

  const body = rows.slice(headerIndex);
  const headerRow = body.shift() ?? [];
  const headers = headerRow.map((h, idx) => h.trim() || `column_${idx + 1}`);
  const totalRows = body.length;
  const capped = body.slice(0, maxRows);
  if (totalRows > capped.length) {
    notes.push(`Only the first ${maxRows.toLocaleString()} rows were read.`);
  }

  return {
    sheetName: null,
    headers: headers.slice(0, UPLOAD_LIMITS.maxColumns),
    rows: capped.map((r) => r.slice(0, UPLOAD_LIMITS.maxColumns)),
    preamble,
    totalRows,
    truncated: totalRows > capped.length,
    notes,
  };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    // A formula cell: keep the computed result, discard the formula, which is executable content.
    if ('result' in value && value.result !== undefined) return cellToString(value.result as ExcelJS.CellValue);
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join('');
    }
    if ('error' in value) return '';
    if ('hyperlink' in value && typeof value.hyperlink === 'string') {
      return 'text' in value && typeof value.text === 'string' ? value.text : value.hyperlink;
    }
  }
  return '';
}

export async function parseXlsx(bytes: Buffer): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);

  const tables: ParsedTable[] = [];
  const notes: string[] = [];

  workbook.eachSheet((sheet) => {
    const raw: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (r) => {
      if (raw.length >= UPLOAD_LIMITS.maxRows + 1) return;
      const values: string[] = [];
      // `values` is 1-indexed in exceljs; index 0 is always empty.
      const arr = Array.isArray(r.values) ? r.values.slice(1) : [];
      for (let c = 0; c < Math.min(arr.length, UPLOAD_LIMITS.maxColumns); c += 1) {
        values.push(clampCell(cellToString(arr[c] as ExcelJS.CellValue)));
      }
      raw.push(values);
    });

    if (raw.length === 0) return;

    const sheetNotes: string[] = [];
    const headerIndex = findHeaderRow(raw);
    const preamble = raw
      .slice(0, headerIndex)
      .flatMap((r) => r.filter((c) => c.trim() !== ''));
    if (headerIndex > 0) {
      sheetNotes.push(
        `${headerIndex} row(s) above the header were read as captions, not data: ` +
          `${preamble.slice(0, 4).join(' | ')}`,
      );
    }

    const body = raw.slice(headerIndex);
    const headerRow = body.shift() ?? [];
    const headers = headerRow.map((h, idx) => h.trim() || `column_${idx + 1}`);
    const totalRows = body.length;
    if (sheet.rowCount - headerIndex - 1 > body.length) {
      sheetNotes.push(`Only the first ${body.length.toLocaleString()} rows of this sheet were read.`);
    }
    tables.push({
      sheetName: sheet.name,
      headers,
      rows: body,
      preamble,
      totalRows,
      truncated: sheet.rowCount - headerIndex - 1 > body.length,
      notes: sheetNotes,
    });
  });

  if (tables.length === 0) notes.push('The workbook contained no readable rows.');
  if (tables.length > 1) notes.push(`${tables.length} sheets were read; each is profiled separately.`);

  return { tables, encoding: 'xlsx', notes };
}

/**
 * Decode bytes as text, reporting the encoding actually used.
 *
 * Files exported from Excel on Windows are frequently UTF-16LE or cp1252 rather than UTF-8. Reading
 * those as UTF-8 does not fail — it silently produces mojibake, which then becomes a "category" in
 * the profile. Detecting it here is what stops that.
 */
export function decodeText(bytes: Buffer): { text: string; encoding: string; note?: string } {
  // The BOM is stripped after decoding, not before: left in place it becomes the first character
  // of the first header name, producing a column nobody can match by name.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: stripBom(bytes.toString('utf16le')), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes);
    swapped.swap16();
    return { text: stripBom(swapped.toString('utf16le')), encoding: 'utf-16be' };
  }
  const utf8 = bytes.toString('utf8');
  if (utf8.includes('�')) {
    // The replacement character means the bytes were not valid UTF-8. Latin-1 never fails, so the
    // text is at least readable, but the caller is told the encoding is a guess.
    return {
      text: bytes.toString('latin1'),
      encoding: 'latin1 (assumed)',
      note:
        'The file is not valid UTF-8. It was read as Latin-1, so accented and non-Latin characters ' +
        'may be wrong. Re-export it as UTF-8 if the values below look corrupted.',
    };
  }
  return { text: utf8, encoding: 'utf-8' };
}

export async function parseFile(
  bytes: Buffer,
  kind: 'csv' | 'xlsx',
): Promise<ParseResult> {
  if (kind === 'xlsx') return parseXlsx(bytes);
  const { text, encoding, note } = decodeText(bytes);
  const table = parseCsv(text);
  return { tables: [table], encoding, notes: note ? [note, ...table.notes] : table.notes };
}
