/**
 * The cast for the roundtable: in every chosen market, three income tiers.
 *
 * A market's published household-income bands are ordered low to high and split into three
 * contiguous tiers of roughly equal respondent base — tier 1 the highest incomes ("Premium
 * Pioneers"), tier 3 the lowest ("Price-led Newcomers"). Each tier is described by the statements on
 * which it differs most from the market as a whole: a base-weighted share across its bands against
 * the market's "All" share, with the tier's base. Nothing here is invented; the illustrative name,
 * age and occupation are written later by the model and labelled as illustrative.
 *
 * A market that publishes no income break falls back to its age groups, and says so.
 */
import { BASE_RESPONSE } from '@/forecast/series';
import { rowsOf, type Row } from './longCohort';

export const TIER_LABELS = ['Premium Pioneers', 'Quality Mainstream', 'Price-led Newcomers'] as const;
export const AGE_TIER_LABELS = ['Younger adults', 'Mid-life adults', 'Older adults'] as const;

const INCOME_GROUP = /income/i;
const AGE_GROUP = /^(age groups?|age)$/i;
const NO_ANSWER = /prefer not|refus|don.?t know|no answer|not stated|not sure|decline/i;
const STATS = 8;

export interface CastStat {
  id: string;
  statement: string;
  response: string;
  share: number;
  overall: number;
  diff: number;
  base: number;
}

export interface CastSeed {
  market: string;
  tier: 1 | 2 | 3;
  tierLabel: string;
  basis: 'income' | 'age';
  bands: string[];
  base: number;
  stats: CastStat[];
}

const UNITS: [RegExp, number][] = [
  [/^(bn|billion|b)\b/i, 1e9],
  [/^(mn|million|mil|m)\b/i, 1e6],
  [/^(crore|cr)\b/i, 1e7],
  [/^(lakh|lac)\b/i, 1e5],
  [/^万/, 1e4],
  [/^千/, 1e3],
  [/^(k|thousand)\b/i, 1e3],
];
const TEXT_RANK: [RegExp, number][] = [
  [/upper[\s-]*middle|upper[\s-]*mid/i, 4],
  [/lower[\s-]*middle|lower[\s-]*mid/i, 2],
  [/\b(very high|highest|top)\b/i, 6],
  [/\b(very low|lowest|bottom)\b/i, 0],
  [/\bhigh(er)?\b/i, 5],
  [/\bmiddle|medium|mid\b/i, 3],
  [/\blow(er)?\b/i, 1],
];

/**
 * Where an income band sits, low to high. "Less than 5 million" ranks just under 5 million,
 * "10 million or more" just over 10 million; worded bands ("Lower middle") rank by their words.
 * Null for "Prefer not to say" and anything else that is not a band.
 */
export function incomeRank(label: string): number | null {
  if (NO_ANSWER.test(label)) return null;
  const m = /(\d[\d,]*(?:\.\d+)?)\s*([a-zA-Z万千]+)?/.exec(label);
  if (m) {
    let n = Number(m[1]!.replace(/,/g, ''));
    const unit = m[2] ?? '';
    for (const [re, mult] of UNITS) if (re.test(unit)) { n *= mult; break; }
    // A unit stated only later in the label ("5-10 million") applies to the first number too.
    if (!unit || !UNITS.some(([re]) => re.test(unit))) {
      const later = /(\d[\d,.]*)\s*(bn|billion|mn|million|mil|crore|lakh|万|千|k|thousand)\b/i.exec(label.slice(m.index + m[0].length));
      const mult = later ? UNITS.find(([re]) => re.test(later[2]!))?.[1] : undefined;
      if (mult) n *= mult;
    }
    if (/less than|under|below|up to|<|以下|不到/i.test(label)) return n - 0.5;
    if (/or more|and above|above|over|more than|\+|>|以上/i.test(label)) return n + 0.5;
    return n;
  }
  for (const [re, rank] of TEXT_RANK) if (re.test(label)) return rank;
  return null;
}

/** Age bands rank by their first number ("18-24" → 18, "55+" → 55). */
function ageRank(label: string): number | null {
  if (NO_ANSWER.test(label)) return null;
  const m = /(\d+)/.exec(label);
  return m ? Number(m[1]) : null;
}

/**
 * Split ordered bands (low → high) into up to three contiguous tiers of roughly equal base.
 * Returned high → low, so index 0 is tier 1.
 */
export function splitTiers<T extends { base: number }>(ordered: T[]): T[][] {
  if (ordered.length === 0) return [];
  if (ordered.length <= 3) return ordered.map((b) => [b]).reverse();
  // Bands are few, so try every pair of cut points and keep the most even split by base.
  const w = ordered.map((b) => Math.max(1, b.base));
  const sum = (from: number, to: number) => w.slice(from, to).reduce((s, x) => s + x, 0);
  const third = sum(0, w.length) / 3;
  let best: [number, number] = [1, 2];
  let bestCost = Infinity;
  for (let i = 1; i < w.length - 1; i += 1) {
    for (let j = i + 1; j < w.length; j += 1) {
      const cost = [sum(0, i), sum(i, j), sum(j, w.length)].reduce((c, x) => c + (x - third) ** 2, 0);
      if (cost < bestCost) [best, bestCost] = [[i, j], cost];
    }
  }
  return [ordered.slice(best[1]), ordered.slice(best[0], best[1]), ordered.slice(0, best[0])];
}

interface Band { label: string; base: number; rows: Row[] }

function bandsOf(rows: Row[], groupTest: RegExp, rank: (l: string) => number | null): { bands: Band[]; group: string } | null {
  const groups = new Map<string, Row[]>();
  for (const r of rows) if (groupTest.test(r.group)) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  if (groups.size === 0) return null;
  // Several income breaks (one per wave, say): take the one with the most rows.
  const [group, chosen] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
  const by = new Map<string, Band>();
  for (const r of chosen) {
    if (rank(r.segment) === null) continue;
    const b = by.get(r.segment) ?? { label: r.segment, base: 0, rows: [] };
    b.base = Math.max(b.base, r.base ?? 0);
    b.rows.push(r);
    by.set(r.segment, b);
  }
  const bands = [...by.values()].sort((a, b) => rank(a.label)! - rank(b.label)!);
  return bands.length >= 2 ? { bands, group } : null;
}

function tierStats(tier: Band[], overall: Map<string, number>): CastStat[] {
  const pooled = new Map<string, { statement: string; response: string; num: number; den: number }>();
  for (const band of tier) {
    const w = Math.max(1, band.base);
    for (const r of band.rows) {
      const k = `${r.statement}|${r.response}`;
      const p = pooled.get(k) ?? { statement: r.statement, response: r.response, num: 0, den: 0 };
      p.num += r.share * w;
      p.den += w;
      pooled.set(k, p);
    }
  }
  const base = tier.reduce((s, b) => s + b.base, 0);
  return [...pooled.entries()]
    .map(([k, p]) => {
      const o = overall.get(k);
      if (o === undefined || p.den === 0) return null;
      const share = Math.round((p.num / p.den) * 10) / 10;
      return { statement: p.statement, response: p.response, share, overall: o, diff: Math.round((share - o) * 10) / 10, base };
    })
    .filter((x): x is Omit<CastStat, 'id'> => x !== null && x.share >= 15 && x.diff > 0 && !BASE_RESPONSE.test(x.response))
    .sort((a, b) => b.diff - a.diff)
    .slice(0, STATS)
    .map((s, i) => ({ ...s, id: `S${i + 1}` }));
}

/**
 * Build the cast seeds from every long survey table available. Rows from several datasets for the
 * same market are pooled; each dataset's latest wave is used.
 */
export function buildCastSeeds(
  tables: { headers: string[]; rows: string[][] }[],
  markets: string[],
): { seeds: CastSeed[]; notes: string[] } {
  const want = new Set(markets.map((m) => m.trim().toLowerCase()));
  const byMarket = new Map<string, Row[]>();
  for (const t of tables) {
    const rows = rowsOf(t.headers, t.rows);
    const latest = new Map<string, number>();
    for (const r of rows) latest.set(r.market, Math.max(latest.get(r.market) ?? 0, r.t));
    for (const r of rows) {
      if (r.t !== latest.get(r.market)) continue;
      if (want.size && !want.has(r.market.toLowerCase())) continue;
      byMarket.set(r.market, [...(byMarket.get(r.market) ?? []), r]);
    }
  }
  const seeds: CastSeed[] = [];
  const notes: string[] = [];
  const ordered = markets.length ? markets.map((m) => [...byMarket.keys()].find((k) => k.toLowerCase() === m.trim().toLowerCase()) ?? m) : [...byMarket.keys()].sort();
  for (const market of ordered) {
    const rows = byMarket.get(market);
    if (!rows?.length) {
      notes.push(`${market}: no survey rows were found in the cleared data, so it has no cast.`);
      continue;
    }
    const overall = new Map<string, number>();
    for (const r of rows) if (r.group.toLowerCase() === 'all') overall.set(`${r.statement}|${r.response}`, r.share);
    let basis: CastSeed['basis'] = 'income';
    let found = bandsOf(rows, INCOME_GROUP, incomeRank);
    if (!found) {
      found = bandsOf(rows, AGE_GROUP, ageRank);
      basis = 'age';
      if (found) notes.push(`${market}: no household-income break is published, so its three tiers are age groups.`);
    }
    if (!found) {
      notes.push(`${market}: neither an income nor an age break is published, so it has no cast.`);
      continue;
    }
    // Age tiers run young → old as tier 1 → 3; income tiers run high → low.
    const tiers = basis === 'age' ? splitTiers(found.bands).reverse() : splitTiers(found.bands);
    tiers.forEach((bands, i) => {
      const tier = (i + 1) as 1 | 2 | 3;
      seeds.push({
        market,
        tier,
        tierLabel: (basis === 'age' ? AGE_TIER_LABELS : TIER_LABELS)[i]!,
        basis,
        bands: bands.map((b) => b.label),
        base: bands.reduce((s, b) => s + b.base, 0),
        stats: tierStats(bands, overall),
      });
    });
  }
  return { seeds, notes };
}
