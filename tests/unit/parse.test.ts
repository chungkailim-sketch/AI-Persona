import { describe, it, expect } from 'vitest';
import { parseCsv, decodeText } from '@/ingest/parse';
import { UPLOAD_LIMITS } from '@/ingest/limits';

describe('CSV parsing', () => {
  it('reads a plain file', () => {
    const t = parseCsv('market,score\nIndonesia,72\nGermany,54\n');
    expect(t.headers).toEqual(['market', 'score']);
    expect(t.rows).toEqual([
      ['Indonesia', '72'],
      ['Germany', '54'],
    ]);
    expect(t.totalRows).toBe(2);
  });

  it('keeps a delimiter that is inside quotes', () => {
    const t = parseCsv('city,score\n"Jakarta, Indonesia",72\n');
    expect(t.rows[0]).toEqual(['Jakarta, Indonesia', '72']);
  });

  it('handles escaped quotes and embedded newlines', () => {
    const t = parseCsv('quote,who\n"She said ""yes"" twice",panel\n"line one\nline two",panel\n');
    expect(t.rows[0]?.[0]).toBe('She said "yes" twice');
    expect(t.rows[1]?.[0]).toBe('line one\nline two');
    expect(t.rows).toHaveLength(2);
  });

  it('strips a byte-order mark so the first column is not named "\\ufeffmarket"', () => {
    const t = parseCsv('﻿market,score\nIndonesia,72\n');
    expect(t.headers[0]).toBe('market');
  });

  it('detects a tab-separated file without being told', () => {
    const t = parseCsv('market\tscore\nIndonesia\t72\n');
    expect(t.headers).toEqual(['market', 'score']);
    expect(t.rows[0]).toEqual(['Indonesia', '72']);
    expect(t.notes.join(' ')).toMatch(/tab/i);
  });

  it('names empty header cells rather than producing a blank column', () => {
    const t = parseCsv('market,,score\nIndonesia,x,72\n');
    expect(t.headers).toEqual(['market', 'column_2', 'score']);
  });

  it('reports an unterminated quote instead of failing silently', () => {
    const t = parseCsv('a,b\n"unterminated,2\n');
    expect(t.notes.join(' ')).toMatch(/ended inside a quoted value/i);
  });

  it('truncates an absurdly long cell', () => {
    const huge = 'x'.repeat(UPLOAD_LIMITS.maxCellChars + 500);
    const t = parseCsv(`a\n${huge}\n`);
    expect(t.rows[0]?.[0]).toHaveLength(UPLOAD_LIMITS.maxCellChars);
  });
});

describe('text decoding', () => {
  it('reads UTF-8', () => {
    const r = decodeText(Buffer.from('café', 'utf8'));
    expect(r.text).toBe('café');
    expect(r.encoding).toBe('utf-8');
  });

  it('reads UTF-16LE from its byte-order mark', () => {
    const r = decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('café', 'utf16le')]));
    expect(r.text).toBe('café');
    expect(r.encoding).toBe('utf-16le');
  });

  it('falls back to Latin-1 and says so, rather than yielding replacement characters', () => {
    // 0xE9 is "é" in Latin-1 and invalid on its own in UTF-8.
    const r = decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    expect(r.text).toBe('café');
    expect(r.encoding).toMatch(/assumed/);
    expect(r.note).toMatch(/not valid UTF-8/i);
  });
});

describe('header detection', () => {
  it('skips caption rows above the real header', () => {
    // The shape of a real supplier export: the market and wave sit above the header, and taking
    // row 0 as the header collapses the whole file into one column.
    const t = parseCsv(
      [
        'Country: Indonesia',
        'Wave: Q1 2026',
        'market,age_band,purchase_intent',
        'Indonesia,25-34,4',
        'Indonesia,35-44,5',
      ].join('\n'),
    );
    expect(t.headers).toEqual(['market', 'age_band', 'purchase_intent']);
    expect(t.rows).toHaveLength(2);
    expect(t.preamble).toEqual(['Country: Indonesia', 'Wave: Q1 2026']);
    expect(t.notes.join(' ')).toMatch(/above the header were read as captions/);
  });

  it('leaves an ordinary file alone', () => {
    const t = parseCsv('market,score\nIndonesia,72\nGermany,54\n');
    expect(t.headers).toEqual(['market', 'score']);
    expect(t.preamble).toEqual([]);
    expect(t.rows).toHaveLength(2);
  });

  it('does not mistake a wide data row for a header', () => {
    const t = parseCsv('market,score,wave\nIndonesia,72,Q1\nIndonesia,54,Q2\n');
    expect(t.headers).toEqual(['market', 'score', 'wave']);
    expect(t.rows).toHaveLength(2);
  });
});
