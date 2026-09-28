import { describe, expect, it } from 'vitest';
import {
  dataPackage,
  draftToCsv,
  inferColumn,
  readNumber,
  structureSurveyLong,
  structureTabular,
  toIdentifier,
  uniqueIdentifiers,
} from '../../src/ingest/structure';
import type { ParsedTable } from '../../src/ingest/parse';

function table(headers: string[], rows: string[][], sheetName: string | null = null): ParsedTable {
  return { sheetName, headers, rows, preamble: [], totalRows: rows.length, truncated: false, notes: [] };
}

describe('identifiers', () => {
  it('turns headers into stable snake_case identifiers', () => {
    expect(toIdentifier('Age Group (%)')).toBe('age_group_pct');
    expect(toIdentifier('  Café  Spend £ ')).toBe('cafe_spend');
    expect(toIdentifier('2024 wave')).toBe('c_2024_wave');
    expect(toIdentifier('***')).toBe('column');
  });

  it('keeps duplicate headers apart', () => {
    expect(uniqueIdentifiers(['Share', 'share', 'SHARE'])).toEqual(['share', 'share_2', 'share_3']);
  });
});

describe('reading numbers', () => {
  it('reads separators and percent signs the way a person would', () => {
    expect(readNumber('1,234')).toEqual({ value: 1234, percent: false });
    expect(readNumber('45%')).toEqual({ value: 45, percent: true });
    expect(readNumber('$12.50')).toEqual({ value: 12.5, percent: false });
  });

  it('does not guess at ambiguous or non-numeric text', () => {
    expect(readNumber('1,5')).toBeNull();
    expect(readNumber('(12)')).toBeNull();
    expect(readNumber('25-34')).toBeNull();
    expect(readNumber('')).toBeNull();
  });

  it('keeps a column as text when a single value is not a number', () => {
    expect(inferColumn(['1', '2', 'n/a', '3'])).toEqual({ type: 'integer' });
    expect(inferColumn(['1', '2', 'many'])).toEqual({ type: 'string' });
    expect(inferColumn(['10%', '20%', '30%'])).toEqual({ type: 'number', unit: 'percent' });
  });
});

describe('structuring an ordinary table', () => {
  const draft = structureTabular(
    table(
      ['Market', 'Age Band', 'Spend (USD)', 'Empty'],
      [
        ['Indonesia', '25-34', '1,200', ''],
        ['', '', '', ''],
        ['Germany', 'n/a', '850', '-'],
      ],
      'Sheet 1',
    ),
    'survey.xlsx',
  );

  it('names columns as identifiers and maps each back to its source header and field', () => {
    expect(draft.columns.map((c) => c.name)).toEqual(['market', 'age_band', 'spend_usd']);
    expect(draft.columns[2]).toMatchObject({ sourceName: 'Spend (USD)', fieldName: 'Sheet 1/Spend (USD)', type: 'integer' });
  });

  it('blanks "no data" markers, writes numbers plainly and drops empty rows and columns', () => {
    expect(draft.rows).toEqual([
      ['Indonesia', '25-34', '1200'],
      ['Germany', '', '850'],
    ]);
    expect(draft.notes.join(' ')).toMatch(/1 column\(s\) had no values/);
    expect(draft.notes.join(' ')).toMatch(/1 empty row/);
  });

  it('writes RFC 4180 CSV and can leave withheld columns out', () => {
    expect(draftToCsv(draft)).toBe('market,age_band,spend_usd\nIndonesia,25-34,1200\nGermany,,850\n');
    expect(draftToCsv(draft, new Set(['market']))).toBe('market\nIndonesia\nGermany\n');
    const quoted = structureTabular(table(['a'], [['x, "y"']]), 'q.csv');
    expect(draftToCsv(quoted)).toBe('a\n"x, ""y"""\n');
  });
});

describe('structuring a flattened databook', () => {
  const row = (market: string, year: number, month: string, share: number) => ({
    market, wave: `${month} ${year}`, wave_year: year, wave_month: month, question_id: 'Q2', statement: 'I trust ads',
    response: 'Agree', segment_group: 'Age groups', segment: '18-24', sample_base: 200 as number | '', share,
  });

  it('orders rows by market and wave so the table reads longitudinally', () => {
    const d = structureSurveyLong([row('Mexico', 2026, 'March', 30), row('China', 2025, 'October', 20), row('China', 2024, 'March', 10)], ['a.xlsx'], []);
    expect(d.kind).toBe('survey_long');
    expect(d.rows.map((r) => `${r[0]} ${r[1]}`)).toEqual(['China March 2024', 'China October 2025', 'Mexico March 2026']);
    expect(d.columns.find((c) => c.name === 'share')).toMatchObject({ type: 'number', unit: 'percent' });
  });

  it('describes the set as a Frictionless tabular data package', () => {
    const d = structureSurveyLong([row('China', 2024, 'March', 10)], ['a.xlsx'], []);
    const pkg = dataPackage({ name: 'Mintel — China', title: 'Mintel', version: 1, tables: [{ ...d, rowCount: 1 }], sources: ['a.xlsx'], created: new Date(0) }) as {
      profile: string; name: string; resources: { path: string; schema: { fields: { name: string; type: string }[] } }[];
    };
    expect(pkg.profile).toBe('tabular-data-package');
    expect(pkg.name).toBe('mintel-china');
    expect(pkg.resources[0]!.path).toBe('survey_responses.csv');
    expect(pkg.resources[0]!.schema.fields.find((f) => f.name === 'sample_base')!.type).toBe('integer');
  });
});
