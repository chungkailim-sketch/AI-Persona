import { describe, it, expect } from 'vitest';
import { parseFileName, toCsv, monthIndex, MINTEL_COLUMNS, type MintelRow } from '@/demo/mintel';

/**
 * The adapter's own judgement, tested without a workbook.
 *
 * Reading a real databook is covered by the integration path; what matters here is that the two
 * pieces of metadata every row depends on — market and wave — are either read correctly or refused
 * outright. A row that cannot say which market and which wave it describes is worse than no row,
 * because it will be averaged into something.
 */
describe('reading market and wave from a databook filename', () => {
  it('reads the real filenames', () => {
    expect(parseFileName('Indonesia-Global Consumer - March 2026 - The Holistic Consumer_.xlsx')).toEqual({
      market: 'Indonesia', wave: 'March 2026', month: 'March', year: 2026,
    });
    expect(parseFileName('US-Global Consumer - September 2024 - The Holistic Consumer.xlsx')).toEqual({
      market: 'US', wave: 'September 2024', month: 'September', year: 2024,
    });
  });

  it('keeps a multi-word market intact', () => {
    expect(parseFileName('Saudi Arabia-Global Consumer - March 2025 - The Holistic Consumer.xlsx')?.market)
      .toBe('Saudi Arabia');
  });

  it('survives the invisible characters these exports carry', () => {
    // The March 2026 files contain a zero-width mark before the extension.
    const r = parseFileName('China-Global Consumer - March 2026 - The Holistic Consumer‎.xlsx');
    expect(r?.market).toBe('China');
    expect(r?.wave).toBe('March 2026');
  });

  it('refuses a filename it cannot read, rather than guessing', () => {
    expect(parseFileName('some-export.xlsx')).toBeNull();
    expect(parseFileName('Global Consumer 2026.xlsx')).toBeNull();
    expect(parseFileName('Indonesia.xlsx')).toBeNull();
  });
});

describe('waves sort chronologically', () => {
  it('orders September after March within a year', () => {
    expect(monthIndex('March')).toBeLessThan(monthIndex('September'));
  });
});

describe('the CSV it writes', () => {
  const row: MintelRow = {
    market: 'Indonesia', wave: 'March 2026', wave_year: 2026, wave_month: 'March',
    question_id: 'Q1', statement: 'I enjoy taking risks', response: 'Strongly agree',
    segment_group: 'Age groups', segment: '18-24', sample_base: 250, share: 29.3,
  };

  it('writes the header and every column, in order', () => {
    const [header] = toCsv([row]).split('\n');
    expect(header).toBe(MINTEL_COLUMNS.join(','));
  });

  it('does not carry the verbatim question on every row', () => {
    // It is published once, in its own table. Repeating it here tripled the file.
    expect(MINTEL_COLUMNS).not.toContain('question');
  });

  it('quotes a value containing a comma rather than splitting the row', () => {
    const csv = toCsv([{ ...row, statement: 'Price, quality and convenience' }]);
    expect(csv.split('\n')[1]).toContain('"Price, quality and convenience"');
    expect(csv.split('\n')).toHaveLength(2);
  });

  it('escapes an embedded quote', () => {
    const csv = toCsv([{ ...row, statement: 'I call it "value"' }]);
    expect(csv.split('\n')[1]).toContain('"I call it ""value"""');
  });

  it('leaves a missing base empty rather than writing a zero', () => {
    // A zero base would be read downstream as "nobody", which is a different claim from "unknown".
    expect(toCsv([{ ...row, sample_base: '' }]).split('\n')[1]).toContain(',,');
  });
});
