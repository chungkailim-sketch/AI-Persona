import { describe, it, expect } from 'vitest';
import { calibrate, crossCells, DEFAULT_RULES, hamiltonAllocate, renderMember, sampleCell, validate, weightedShare, wilson } from '../../src/population/core';
import { buildPopulation, isRollUp, parseBand, partitionBands } from '../../src/population/build';

describe('Hamilton allocation', () => {
  it('sums exactly to the total and is proportional', () => {
    const q = hamiltonAllocate(10, { a: 1, b: 1, c: 1 });
    expect(Object.values(q).reduce((s, v) => s + v, 0)).toBe(10);
    expect(q).toEqual({ a: 4, b: 3, c: 3 });
  });
  it('gives zero to zero-weight cells', () => {
    expect(hamiltonAllocate(5, { a: 0, b: 2 })).toEqual({ a: 0, b: 5 });
  });
});

describe('bands and roll-ups', () => {
  it('parses bands', () => {
    expect(parseBand('18-24')).toEqual([18, 24]);
    expect(parseBand('55+')).toEqual([55, Infinity]);
    expect(parseBand('Female')).toBeNull();
  });
  it('picks a non-overlapping partition from overlapping published bands', () => {
    expect(partitionBands(['18-24', '18-34', '25-34', '35-44', '45+', '45-54', '55+'])).toEqual(['18-24', '25-34', '35-44', '45-54', '55+']);
  });
  it('recognises net segments that overlap their parts', () => {
    expect(isRollUp('Employed (full-time, part-time, or self-employed)')).toBe(true);
    expect(isRollUp('Total')).toBe(true);
    expect(isRollUp('Working full-time')).toBe(false);
  });
});

describe('consistency rules', () => {
  it('match a rule value as a leading word', () => {
    expect(validate({ age: '18-24', employment: 'Retired/pensioner' }, DEFAULT_RULES)).toHaveLength(1);
    expect(validate({ age: '18-24', employment: 'Retiredish' }, DEFAULT_RULES)).toHaveLength(0);
  });
  it('remove impossible cells and renormalise', () => {
    const { cells, removed } = crossCells([{ dimension: 'age', marginal: { '18-24': 0.5, '65+': 0.5 } }, { dimension: 'employment', marginal: { Retired: 0.5, 'Working full-time': 0.5 } }], DEFAULT_RULES);
    expect(removed).toEqual(['18-24 × Retired']);
    expect(cells.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1);
  });
});

describe('sampling', () => {
  const cell = { key: 'x', values: { age: '25-34' }, weight: 1 };
  const marg = { q1: { Agree: 70, Disagree: 30 } };
  it('is deterministic for a seed and changes with it', () => {
    const a = sampleCell(cell, 50, marg, 7).members.map((m) => m.drawn.q1);
    const b = sampleCell(cell, 50, marg, 7).members.map((m) => m.drawn.q1);
    const c = sampleCell(cell, 50, marg, 8).members.map((m) => m.drawn.q1);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it('calibrates close to the target at scale', () => {
    const { members } = sampleCell(cell, 4000, marg, 1);
    const [row] = calibrate(members, { q1: { Agree: 70, Disagree: 30 } });
    expect(row!.maxAbsErrorPp).toBeLessThan(3);
  });
  it('renders pinned and drawn values with provenance and a budget', () => {
    const { members } = sampleCell(cell, 1, { q1: { Agree: 1 }, q2: { Yes: 1 } }, 1);
    const text = renderMember(members[0]!, {}, 120);
    expect(text).toMatch(/Segment membership \(observed\)/);
    expect(text).toMatch(/not a real respondent/);
  });
});

describe('roll-up helpers', () => {
  it('weighted share and Wilson interval', () => {
    expect(weightedShare([{ weight: 3, value: 'confirm' }, { weight: 1, value: 'dispute' }], 'confirm')).toBe(75);
    expect(weightedShare([], 'confirm')).toBeNull();
    const w = wilson(50, 100);
    expect(w.lo).toBeLessThan(50);
    expect(w.hi).toBeGreaterThan(50);
  });
});

describe('buildPopulation', () => {
  const H = ['market', 'wave', 'wave_year', 'wave_month', 'question_id', 'statement', 'response', 'segment_group', 'segment', 'sample_base', 'share'];
  const row = (y: number, m: string, group: string, seg: string, base: number, resp: string, share: number, st = 'I enjoy taking risks') => ['US', `${m} ${y}`, String(y), m, 'Q1', st, resp, group, seg, String(base), String(share)];
  const rows = [
    // An older wave that must be ignored.
    row(2025, 'September', 'Age groups', '18-24', 900, 'Agree', 90),
    ...[['18-24', 200, 60], ['18-34', 450, 55], ['25-34', 250, 50], ['35+', 550, 30]].flatMap(([seg, base, agree]) => [
      row(2026, 'March', 'Age groups', seg as string, base as number, 'Agree', agree as number),
      row(2026, 'March', 'Age groups', seg as string, base as number, 'Disagree', 100 - (agree as number)),
    ]),
    row(2026, 'March', 'Age groups', '18-24', 200, 'Sample', 71000),
    row(2026, 'March', 'Employment', 'Retired', 300, 'Agree', 20),
    row(2026, 'March', 'Employment', 'Working full-time', 700, 'Agree', 45),
    row(2026, 'March', 'Employment', 'Employed (full-time, part-time, or self-employed)', 800, 'Agree', 44),
  ];
  it('builds a reproducible, quota-exact population from the latest wave', () => {
    const spec = { size: 1000, seed: 3, primaryGroup: 'Age groups', secondaryGroup: 'Employment' };
    const a = buildPopulation(H, rows, spec);
    const b = buildPopulation(H, rows, spec);
    expect(a.wave).toBe('March 2026');
    expect(a.segments.primary).toEqual(['18-24', '25-34', '35+']);
    expect(a.segments.secondary).toEqual(['Retired', 'Working full-time']);
    expect(a.removedCells).toEqual(['18-24 × Retired']);
    expect(a.members).toBe(1000);
    expect(a.quotas.reduce((s, q) => s + q.members, 0)).toBe(1000);
    expect(a.examples).toEqual(b.examples);
    expect(a.assumptions.join(' ')).toMatch(/not a census/);
    expect(a.assumptions.join(' ')).toMatch(/SIMULATED/);
    const cal = a.calibration.find((c) => c.dimension === 'I enjoy taking risks')!;
    expect(cal.maxAbsErrorPp).toBeLessThan(5);
  });
});

describe('partitionByBases', () => {
  it('drops nets that equal the sum of their parts, even when a label gives no hint', async () => {
    const { partitionByBases } = await import('../../src/population/build');
    // US, March 2026, as published.
    const us = new Map(Object.entries({
      'Working full-time': 343, 'Working part-time': 205, 'Retired/pensioner': 212, 'Not employed': 404,
      'Employed (full-time, part-time, or self-employed/freelancer/temporary contract worker)': 596,
      'Self-employed/freelancer/temporary contract worker': 48, 'Homemaker/full-time parent': 42,
      'Full-time student': 46, 'Unemployed - looking for work': 61, 'Not working for any other reason': 43,
    }));
    const p = partitionByBases(us, 1000)!;
    expect(p).toHaveLength(8);
    expect(p).not.toContain('Not employed');
    expect(p).not.toContain('Employed (full-time, part-time, or self-employed/freelancer/temporary contract worker)');
    expect(p).toContain('Working full-time');
  });
  it('returns null without a total', async () => {
    const { partitionByBases } = await import('../../src/population/build');
    expect(partitionByBases(new Map([['a', 1]]), null)).toBeNull();
  });
});
