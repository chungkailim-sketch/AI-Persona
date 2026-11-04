/**
 * Market potential and market entry indices — computed in code, never by the model.
 *
 * Every pillar is 0–100 with higher meaning easier entry for a Chinese brand. Pillars come from the
 * team's market inputs (with a source); two can fall back to the roundtable when not entered:
 * brand friendliness (the market's mean overall openness) and category demand (the mean of the
 * market's three most open categories). A pillar with no value is left out and the remaining
 * weights are rescaled, and the slide says which pillars were missing.
 *
 *  Potential (CBEI): brand 22.2%, geo & trade 22.2%, spending 22.2%, category 22.2%, digital 11.1%.
 *    Policy gate: geo & trade ≤ 30 caps the tier at "Selective entry".
 *  Entry:            brand 20%, geo & trade 20%, spending 20%, category 20%, scrutiny 10%, digital 10%.
 *    Each category's sub-score is the entry index with that category's openness as category demand.
 *
 *  Tiers: ≥65 Priority entry · 50–65 Build presence · 40–50 Selective entry · <40 Watch.
 */

export const PILLARS = ['brand', 'geoTrade', 'spending', 'categoryDemand', 'scrutiny', 'digital'] as const;
export type Pillar = (typeof PILLARS)[number];

export const PILLAR_LABEL: Record<Pillar, string> = {
  brand: 'Brand friendliness',
  geoTrade: 'Geopolitics & trade',
  spending: 'Spending power',
  categoryDemand: 'Category demand',
  scrutiny: 'Consumer scrutiny',
  digital: 'Digital readiness',
};

/** Column headings where space is tight. */
export const PILLAR_SHORT: Record<Pillar, string> = {
  brand: 'Brand',
  geoTrade: 'Geo & trade',
  spending: 'Spending',
  categoryDemand: 'Category',
  scrutiny: 'Scrutiny',
  digital: 'Digital',
};

export const POTENTIAL_WEIGHTS: Partial<Record<Pillar, number>> = { brand: 2 / 9, geoTrade: 2 / 9, spending: 2 / 9, categoryDemand: 2 / 9, digital: 1 / 9 };
export const ENTRY_WEIGHTS: Partial<Record<Pillar, number>> = { brand: 0.2, geoTrade: 0.2, spending: 0.2, categoryDemand: 0.2, scrutiny: 0.1, digital: 0.1 };

export const TIERS = [
  { key: 'priority', label: 'Priority entry', min: 65 },
  { key: 'build', label: 'Build presence', min: 50 },
  { key: 'selective', label: 'Selective entry', min: 40 },
  { key: 'watch', label: 'Watch', min: -Infinity },
] as const;
export type TierKey = (typeof TIERS)[number]['key'];

export const GEO_GATE = 30;

export type PillarValues = Partial<Record<Pillar, number | null>>;

export interface MarketInputRow extends PillarValues {
  market: string;
  source?: string | null;
}

export interface RoundtableMarket {
  market: string;
  /** Mean overall openness of the market's personas. */
  overall: number;
  /** Mean openness per category. */
  categories: Record<string, number>;
}

export function tierOf(score: number): (typeof TIERS)[number] {
  return TIERS.find((t) => score >= t.min)!;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Weighted mean over the pillars that have a value; null when none does. */
export function weighted(values: PillarValues, weights: Partial<Record<Pillar, number>>): { score: number | null; missing: Pillar[] } {
  let num = 0;
  let den = 0;
  const missing: Pillar[] = [];
  for (const [p, w] of Object.entries(weights) as [Pillar, number][]) {
    const v = values[p];
    if (v === null || v === undefined || !Number.isFinite(v)) {
      missing.push(p);
      continue;
    }
    num += v * w;
    den += w;
  }
  return { score: den > 0 ? r1(num / den) : null, missing };
}

export interface ResolvedPillars {
  values: PillarValues;
  /** Pillars filled from the roundtable rather than entered. */
  fromRoundtable: Pillar[];
}

export function resolvePillars(input: MarketInputRow | undefined, rt: RoundtableMarket | undefined): ResolvedPillars {
  const values: PillarValues = {};
  const fromRoundtable: Pillar[] = [];
  for (const p of PILLARS) values[p] = input?.[p] ?? null;
  if ((values.brand ?? null) === null && rt) {
    values.brand = r1(rt.overall);
    fromRoundtable.push('brand');
  }
  if ((values.categoryDemand ?? null) === null && rt) {
    const top = Object.values(rt.categories).sort((a, b) => b - a).slice(0, 3);
    if (top.length) {
      values.categoryDemand = r1(top.reduce((s, x) => s + x, 0) / top.length);
      fromRoundtable.push('categoryDemand');
    }
  }
  return { values, fromRoundtable };
}

export interface PotentialRow {
  market: string;
  score: number | null;
  tier: TierKey | null;
  gated: boolean;
  missing: Pillar[];
  fromRoundtable: Pillar[];
  topCategories: { category: string; score: number }[];
  values: PillarValues;
  source: string | null;
}

export function potentialIndex(markets: string[], inputs: MarketInputRow[], rt: RoundtableMarket[]): PotentialRow[] {
  return markets
    .map((market) => {
      const input = inputs.find((i) => i.market.toLowerCase() === market.toLowerCase());
      const r = rt.find((x) => x.market.toLowerCase() === market.toLowerCase());
      const { values, fromRoundtable } = resolvePillars(input, r);
      const { score, missing } = weighted(values, POTENTIAL_WEIGHTS);
      let tier: TierKey | null = score === null ? null : tierOf(score).key;
      const gated = tier !== null && values.geoTrade != null && values.geoTrade <= GEO_GATE && (tier === 'priority' || tier === 'build');
      if (gated) tier = 'selective';
      const topCategories = r
        ? Object.entries(r.categories)
            .map(([category, s]) => ({ category, score: Math.round(s) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
        : [];
      return { market, score, tier, gated, missing, fromRoundtable, topCategories, values, source: input?.source ?? null };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

export interface EntryRow {
  market: string;
  score: number | null;
  tier: TierKey | null;
  missing: Pillar[];
  fromRoundtable: Pillar[];
  values: PillarValues;
  categories: Record<string, number | null>;
  lead: string | null;
}

export function entryIndex(markets: string[], categories: string[], inputs: MarketInputRow[], rt: RoundtableMarket[]): EntryRow[] {
  return markets
    .map((market) => {
      const input = inputs.find((i) => i.market.toLowerCase() === market.toLowerCase());
      const r = rt.find((x) => x.market.toLowerCase() === market.toLowerCase());
      const { values, fromRoundtable } = resolvePillars(input, r);
      const { score, missing } = weighted(values, ENTRY_WEIGHTS);
      const subs: Record<string, number | null> = {};
      for (const c of categories) {
        const open = r?.categories[c];
        subs[c] = open === undefined ? null : weighted({ ...values, categoryDemand: open }, ENTRY_WEIGHTS).score;
      }
      const ranked = Object.entries(subs).filter((e): e is [string, number] => e[1] !== null).sort((a, b) => b[1] - a[1]);
      return { market, score, tier: score === null ? null : tierOf(score).key, missing, fromRoundtable, values, categories: subs, lead: ranked[0]?.[0] ?? null };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/** Openness band used across the report: ≥60 willing, 40–59 depends, <40 unlikely. */
export function band(score: number): 'willing' | 'depends' | 'unlikely' {
  return score >= 60 ? 'willing' : score >= 40 ? 'depends' : 'unlikely';
}

export const BAND_LABEL = { willing: 'Willing', depends: 'Depends', unlikely: 'Unlikely' } as const;
