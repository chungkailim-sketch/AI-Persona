import { describe, it, expect } from 'vitest';
import { profileField, profileTable } from '@/ingest/profile';

describe('field type inference', () => {
  it('calls a small consecutive integer range ordinal, not numeric', () => {
    // This is the distinction that stops a mean being reported over rank labels.
    const p = profileField('agreement', ['1', '2', '3', '4', '5', '3', '4', '2', '5', '1']);
    expect(p.type).toBe('ORDINAL');
    expect(p.scalePoints).toBe(5);
    expect(p.notes.join(' ')).toMatch(/5-point scale/);
  });

  it('calls a wide numeric range numeric', () => {
    const p = profileField('spend', ['12.5', '340', '7', '1290', '88', '4021', '12', '9']);
    expect(p.type).toBe('NUMERIC');
    expect(p.numeric?.min).toBe(7);
    expect(p.numeric?.max).toBe(4021);
  });

  it('recognises booleans', () => {
    const p = profileField('subscribed', ['yes', 'no', 'yes', 'yes', 'no']);
    expect(p.type).toBe('BOOLEAN');
  });

  it('recognises dates', () => {
    const p = profileField('collected', ['2026-01-15', '2026-02-20', '2026-03-11', '2026-04-02']);
    expect(p.type).toBe('DATE');
  });

  it('recognises an identifier by name and uniqueness together', () => {
    const p = profileField('respondent_id', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    expect(p.type).toBe('IDENTIFIER');
  });

  it('does not call a near-unique column an identifier when the name says otherwise', () => {
    const p = profileField('verbatim', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    expect(p.type).not.toBe('IDENTIFIER');
  });

  it('recognises a small vocabulary as categorical', () => {
    const values = Array.from({ length: 60 }, (_, i) =>
      ['Indonesia', 'Germany', 'Mexico'][i % 3] as string,
    );
    const p = profileField('market', values);
    expect(p.type).toBe('CATEGORICAL');
    expect(p.distinctCount).toBe(3);
  });
});

describe('missingness', () => {
  it('counts the several ways a file says "nothing here"', () => {
    const p = profileField('score', ['5', '', 'NA', 'n/a', 'NULL', '-', '4']);
    expect(p.missingCount).toBe(5);
    expect(p.missingPct).toBeCloseTo(71.4, 0);
  });

  it('warns when most of a field is missing, because the base is not the row count', () => {
    const values = ['1', ...Array.from({ length: 9 }, () => '')];
    const p = profileField('sparse', values);
    expect(p.notes.join(' ')).toMatch(/missing/i);
    expect(p.notes.join(' ')).toMatch(/smaller base/i);
  });
});

describe('outliers', () => {
  it('counts but never removes them', () => {
    const values = [...Array.from({ length: 20 }, () => '10'), '1000'];
    const p = profileField('spend', values);
    expect(p.outlierCount).toBe(1);
    // The extreme value is still in the statistics; it was reported, not dropped.
    expect(p.numeric?.max).toBe(1000);
  });
});

describe('whole-table profiling', () => {
  it('profiles each column independently', () => {
    const headers = ['market', 'score'];
    const rows = [
      ['Indonesia', '4'],
      ['Germany', '2'],
      ['Indonesia', '5'],
    ];
    const profiles = profileTable(headers, rows);
    expect(profiles).toHaveLength(2);
    expect(profiles[0]?.name).toBe('market');
    expect(profiles[1]?.type).toBe('ORDINAL');
  });
});
