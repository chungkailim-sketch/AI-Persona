import { describe, expect, it } from 'vitest';
import { band, entryIndex, potentialIndex, tierOf, weighted } from '../../src/roundtable/marketIndex';
import { matchCategory, roundtableView } from '../../src/roundtable/engine';

describe('market indices', () => {
  it('weights the five potential pillars and rescales over the ones present', () => {
    expect(weighted({ brand: 80, geoTrade: 80, spending: 80, categoryDemand: 80, digital: 80 }, { brand: 1, digital: 1 }).score).toBe(80);
    const partial = weighted({ brand: 90, digital: 30 }, { brand: 2 / 9, geoTrade: 2 / 9, digital: 1 / 9 });
    expect(partial.score).toBe(70);
    expect(partial.missing).toEqual(['geoTrade']);
  });

  it('caps a market at selective entry when geopolitics and trade is 30 or below', () => {
    const [row] = potentialIndex(['India'], [{ market: 'India', brand: 90, geoTrade: 25, spending: 90, categoryDemand: 90, digital: 90 }], []);
    expect(row!.score).toBeGreaterThan(65);
    expect(row!.tier).toBe('selective');
    expect(row!.gated).toBe(true);
  });

  it('fills brand friendliness and category demand from the roundtable when not entered, and says so', () => {
    const rt = [{ market: 'Thailand', overall: 62, categories: { Beauty: 80, Food: 70, Tech: 60, Travel: 20 } }];
    const [row] = potentialIndex(['Thailand'], [], rt);
    expect(row!.values.brand).toBe(62);
    expect(row!.values.categoryDemand).toBe(70);
    expect(row!.fromRoundtable).toEqual(['brand', 'categoryDemand']);
    expect(row!.topCategories.map((c) => c.category)).toEqual(['Beauty', 'Food', 'Tech']);
  });

  it('scores each category with its own openness as category demand, and names the lead', () => {
    const rt = [{ market: 'Malaysia', overall: 50, categories: { Beauty: 90, Tech: 30 } }];
    const [row] = entryIndex(['Malaysia'], ['Beauty', 'Tech', 'Travel'], [{ market: 'Malaysia', geoTrade: 60, spending: 60, scrutiny: 60, digital: 60 }], rt);
    expect(row!.categories.Beauty!).toBeGreaterThan(row!.categories.Tech!);
    expect(row!.categories.Travel).toBeNull();
    expect(row!.lead).toBe('Beauty');
  });

  it('tiers and bands at the stated thresholds', () => {
    expect([65, 64.9, 50, 40, 39.9].map((s) => tierOf(s).key)).toEqual(['priority', 'build', 'build', 'selective', 'watch']);
    expect([60, 59, 40, 39].map(band)).toEqual(['willing', 'depends', 'depends', 'unlikely']);
  });
});

describe('roundtable view', () => {
  it('computes market and category means and features one voice per market', () => {
    const a = (personaId: string, market: string, overall: number) => ({ personaId, market, tier: 1, overall, quote: `q${personaId}`, scores: [{ category: 'Beauty', score: overall, reason: '' }] });
    const v = roundtableView(['Beauty'], [a('1', 'A', 80), a('2', 'A', 20), a('3', 'B', 70), a('4', 'B', 30)]);
    expect(v.markets.find((m) => m.market === 'A')!.overall).toBe(50);
    expect(v.categoryMeans.Beauty).toBe(50);
    expect(v.featured.map((f) => f.personaId)).toEqual(['1', '4']);
    expect(v.bands).toEqual({ willing: 2, depends: 0, unlikely: 2 });
  });

  it('matches a scored category to the one offered despite case and punctuation', () => {
    expect(matchCategory('beauty and personal care', ['Beauty & personal care'])).toBeNull();
    expect(matchCategory('BEAUTY & PERSONAL CARE', ['Beauty & personal care'])).toBe('Beauty & personal care');
    expect(matchCategory('Tech', ['Tech & digital'])).toBe('Tech & digital');
  });
});
