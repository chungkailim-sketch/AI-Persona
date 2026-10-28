import { describe, expect, it } from 'vitest';
import { buildCastSeeds, incomeRank, splitTiers } from '../../src/server/castBuilder';

describe('income band order', () => {
  it('orders numeric bands low to high, with "less than" and "or more" at the ends', () => {
    const bands = ['IDR 10 million or more', 'Less than IDR 3 million', 'IDR 3-5 million', 'IDR 5-10 million', 'Prefer not to say'];
    const ranked = bands.filter((b) => incomeRank(b) !== null).sort((a, b) => incomeRank(a)! - incomeRank(b)!);
    expect(ranked).toEqual(['Less than IDR 3 million', 'IDR 3-5 million', 'IDR 5-10 million', 'IDR 10 million or more']);
  });

  it('reads units and worded bands', () => {
    expect(incomeRank('¥5千-1万')!).toBeLessThan(incomeRank('¥2万以上')!);
    expect(incomeRank('Lower middle')!).toBeLessThan(incomeRank('Upper middle')!);
    expect(incomeRank("Don't know")).toBeNull();
  });
});

describe('splitting bands into three tiers', () => {
  it('returns tier 1 as the highest incomes, every tier non-empty', () => {
    const bands = [1, 2, 3, 4, 5, 6].map((n) => ({ label: `b${n}`, base: 100 }));
    const tiers = splitTiers(bands);
    expect(tiers).toHaveLength(3);
    expect(tiers[0]!.map((b) => b.label)).toEqual(['b5', 'b6']);
    expect(tiers[2]!.map((b) => b.label)).toEqual(['b1', 'b2']);
  });

  it('keeps every tier non-empty when one band holds most of the base', () => {
    const tiers = splitTiers([{ label: 'a', base: 900 }, { label: 'b', base: 10 }, { label: 'c', base: 10 }, { label: 'd', base: 10 }]);
    expect(tiers).toHaveLength(3);
    expect(tiers.every((t) => t.length > 0)).toBe(true);
  });
});

const HEAD = ['market', 'wave', 'wave_year', 'wave_month', 'statement', 'response', 'segment_group', 'segment', 'sample_base', 'share'];
function rows(market: string, group: string, bySeg: Record<string, number>, base = 200): string[][] {
  return Object.entries(bySeg).map(([seg, share]) => [market, 'March 2026', '2026', 'March', 'I buy premium brands', 'Agree', seg === 'All' ? 'All' : group, seg, String(seg === 'All' ? 1000 : base), String(share)]);
}

describe('cast seeds', () => {
  it('builds three income tiers per market, described against the market as a whole', () => {
    const t = { headers: HEAD, rows: rows('Indonesia', 'Monthly household income', { All: 40, 'Less than IDR 3 million': 20, 'IDR 3-5 million': 35, 'IDR 5-10 million': 50, 'IDR 10 million or more': 70 }) };
    const { seeds, notes } = buildCastSeeds([t], ['Indonesia']);
    expect(notes).toEqual([]);
    expect(seeds.map((s) => s.tier)).toEqual([1, 2, 3]);
    expect(seeds[0]!.tierLabel).toBe('Premium Pioneers');
    expect(seeds[0]!.bands).toContain('IDR 10 million or more');
    expect(seeds[0]!.stats[0]).toMatchObject({ id: 'S1', statement: 'I buy premium brands', overall: 40 });
    expect(seeds[0]!.stats[0]!.share).toBeGreaterThan(40);
  });

  it('falls back to age groups, and says so, where no income break is published', () => {
    const t = { headers: HEAD, rows: rows('Japan', 'Age groups', { All: 40, '18-24': 60, '25-34': 50, '35-44': 40, '45-54': 30, '55+': 20 }) };
    const { seeds, notes } = buildCastSeeds([t], ['Japan']);
    expect(seeds).toHaveLength(3);
    expect(seeds[0]!.basis).toBe('age');
    expect(seeds[0]!.bands[0]).toBe('18-24');
    expect(notes[0]).toMatch(/no household-income break/);
  });

  it('names a chosen market that has no data', () => {
    const { seeds, notes } = buildCastSeeds([], ['Peru']);
    expect(seeds).toEqual([]);
    expect(notes[0]).toMatch(/Peru/);
  });
});
