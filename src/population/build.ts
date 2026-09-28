/**
 * Build a synthetic population from a long survey table (the Mintel adapter's shape).
 *
 *  1. Take the latest wave.
 *  2. Choose mutually exclusive segments in the primary group (databooks publish overlapping bands
 *     such as 18-24, 18-34 and 45+ side by side; only a partition can be sampled).
 *  3. Weight segments by their published bases; optionally cross with a secondary group by the
 *     product of marginals, removing impossible cells.
 *  4. Allocate members with Hamilton quotas and draw each tracked statement's answer from the
 *     primary segment's observed response distribution.
 *  5. Report calibration: sampled against target marginals, per dimension.
 */
import { BASE_RESPONSE, isShare } from '@/forecast/series';
import {
  DEFAULT_RULES,
  calibrate,
  crossCells,
  hamiltonAllocate,
  renderMember,
  sampleCell,
  type Dimension,
  type SampledMember,
} from './core';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export interface PopulationSpec {
  size: number;
  seed: number;
  primaryGroup: string;
  secondaryGroup?: string | null;
  maxStatements?: number;
}

export interface PopulationResult {
  wave: string;
  segments: { primary: string[]; secondary: string[] };
  quotas: { cell: string; weight: number; members: number }[];
  removedCells: string[];
  statements: string[];
  calibration: { dimension: string; maxAbsErrorPp: number; worstValue: string }[];
  rejectedDraws: number;
  examples: { id: string; text: string }[];
  assumptions: string[];
  members: number;
  /** Published bases per segment in the sampled wave. */
  bases: { primary: Record<string, number>; secondary: Record<string, number> };
  /**
   * Each primary segment's OBSERVED answer distribution per tracked statement, in percent, in the
   * order the source publishes responses. This is what a persona built from the sample may cite.
   */
  profiles: Record<string, Record<string, { response: string; pct: number }[]>>;
  /** Members per cell, with one simulated example member each (for rendering, never evidence). */
  cellExamples: Record<string, Record<string, string>>;
}

/** "18-24" → [18, 24]; "55+" → [55, Infinity]; anything else → null. */
export function parseBand(label: string): [number, number] | null {
  const r = /^(\d+)\s*-\s*(\d+)$/.exec(label.trim());
  if (r) return [Number(r[1]), Number(r[2])];
  const p = /^(\d+)\s*\+$/.exec(label.trim());
  if (p) return [Number(p[1]), Infinity];
  return null;
}

/**
 * Net or roll-up segments that overlap their own parts — "Employed (full-time, part-time, or
 * self-employed…)", "Any parent", "Total" — cannot sit in a partition beside those parts.
 */
export function isRollUp(label: string): boolean {
  const l = label.trim().toLowerCase();
  if (/^(all|total|net|any|nett?:?)\b/.test(l)) return true;
  const paren = /\(([^)]*)\)/.exec(l)?.[1] ?? '';
  return /,/.test(paren) && /\bor\b/.test(paren);
}

/**
 * The finest partition of a group, found from its published bases: the largest set of segments
 * whose bases add up to the whole sample (within 0.3%). Databooks print nets beside their parts ("Not employed"
 * = retired + homemaker + student + unemployed + other; "Employed" = full-time + part-time +
 * self-employed), and a net cannot sit in a partition next to its own parts. A label heuristic
 * misses nets like "Not employed"; arithmetic does not.
 *
 * Returns null when no subset matches the total, or when the group is too large to
 * search exhaustively (more than 16 segments).
 */
export function partitionByBases(bases: ReadonlyMap<string, number>, total: number | null): string[] | null {
  const items = [...bases.entries()].filter(([k, b]) => b > 0 && !/^(all|total)$/i.test(k));
  if (!total || total <= 0 || items.length === 0 || items.length > 16) return null;
  // Published bases are integers and nets are exact sums, so the tolerance is tight: a loose one
  // lets unrelated segments add up to the total by coincidence.
  const tol = Math.max(1, total * 0.003);
  let best: number[] | null = null;
  let bestErr = Infinity;
  const n = items.length;
  for (let mask = 1; mask < 1 << n; mask += 1) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i += 1) if (mask & (1 << i)) { sum += items[i]![1]; count += 1; }
    const err = Math.abs(sum - total);
    if (err > tol) continue;
    const bestCount = best?.length ?? 0;
    if (count > bestCount || (count === bestCount && err < bestErr)) {
      best = items.map((_, i) => i).filter((i) => mask & (1 << i));
      bestErr = err;
    }
  }
  return best ? best.map((i) => items[i]![0]) : null;
}

/**
 * A partition of age-like bands: contiguous, non-overlapping, narrowest first, ending open-ended
 * if an open band exists. Returns the labels in order; empty if no partition exists.
 */
export function partitionBands(labels: readonly string[]): string[] {
  const bands = labels.map((l) => ({ l, b: parseBand(l) })).filter((x): x is { l: string; b: [number, number] } => x.b !== null);
  if (bands.length === 0) return [];
  const start = Math.min(...bands.map((x) => x.b[0]));
  const byStart = (s: number) => bands.filter((x) => x.b[0] === s).sort((a, b) => a.b[1] - b.b[1]);
  let best: string[] = [];
  const walk = (cursor: number, acc: string[]) => {
    const next = byStart(cursor);
    if (next.length === 0) {
      if (acc.length > best.length) best = [...acc];
      return;
    }
    for (const n of next) {
      if (n.b[1] === Infinity) {
        if (acc.length + 1 > best.length || !best.some((l) => parseBand(l)?.[1] === Infinity)) best = [...acc, n.l];
        continue;
      }
      walk(n.b[1] + 1, [...acc, n.l]);
    }
  };
  walk(start, []);
  return best;
}

export function buildPopulation(headers: readonly string[], rows: readonly (readonly string[])[], spec: PopulationSpec): PopulationResult {
  const col = (n: string) => headers.findIndex((h) => h.trim().toLowerCase() === n);
  const c = { year: col('wave_year'), month: col('wave_month'), statement: col('statement'), response: col('response'), group: col('segment_group'), segment: col('segment'), base: col('sample_base'), share: col('share') };
  if (Object.values(c).some((i) => i < 0)) throw new Error('This table is not a long survey table (wave, statement, response, segment, base, share).');

  // 1. Latest wave.
  let latest = -1;
  for (const r of rows) {
    const t = Number(r[c.year]) * 12 + MONTHS.indexOf((r[c.month] ?? '').toLowerCase());
    if (t > latest) latest = t;
  }
  const inWave = rows.filter((r) => Number(r[c.year]) * 12 + MONTHS.indexOf((r[c.month] ?? '').toLowerCase()) === latest && !BASE_RESPONSE.test((r[c.response] ?? '').trim()));
  const wave = `${MONTHS[latest % 12]!.replace(/^./, (x) => x.toUpperCase())} ${Math.floor(latest / 12)}`;

  const bases = (group: string) => {
    const m = new Map<string, number>();
    for (const r of inWave) {
      if ((r[c.group] ?? '').toLowerCase() !== group.toLowerCase()) continue;
      const b = Number(r[c.base]);
      if (Number.isFinite(b) && b > 0) m.set(r[c.segment]!, Math.max(m.get(r[c.segment]!) ?? 0, b));
    }
    return m;
  };

  // 2. Mutually exclusive primary segments.
  const totalBase = Math.max(0, ...[...bases('all').values()]) || null;
  const partitionOf = (m: Map<string, number>): { segments: string[]; method: 'bands' | 'bases' | 'labels' } => {
    const bands = partitionBands([...m.keys()]);
    if (bands.length > 0) return { segments: bands, method: 'bands' };
    const byBases = partitionByBases(m, totalBase);
    if (byBases && byBases.length >= 2) return { segments: [...m.keys()].filter((k) => byBases.includes(k)), method: 'bases' };
    return { segments: [...m.keys()].filter((s) => !isRollUp(s)), method: 'labels' };
  };
  const primaryBases = bases(spec.primaryGroup);
  const primaryPartition = partitionOf(primaryBases);
  const primary = primaryPartition.segments;
  if (primary.length === 0) throw new Error(`No segments found for "${spec.primaryGroup}" in the latest wave.`);
  const secondaryBases = spec.secondaryGroup ? bases(spec.secondaryGroup) : new Map<string, number>();
  const secondaryPartition = partitionOf(secondaryBases);
  const secondary = secondaryPartition.segments;

  // 3. Cells.
  const norm = (m: Map<string, number>, keys: string[]) => {
    const t = keys.reduce((s, k) => s + (m.get(k) ?? 0), 0) || 1;
    return Object.fromEntries(keys.map((k) => [k, (m.get(k) ?? 0) / t]));
  };
  const primaryMarginal = norm(primaryBases, primary);
  const strata = [{ dimension: 'age', marginal: primaryMarginal }];
  const secondaryDim = spec.secondaryGroup ? spec.secondaryGroup.toLowerCase().includes('employ') ? 'employment' : spec.secondaryGroup.toLowerCase().includes('parent') ? 'parental_status' : spec.secondaryGroup.toLowerCase().replace(/\s+/g, '_') : null;
  if (secondaryDim && secondary.length) strata.push({ dimension: secondaryDim, marginal: norm(secondaryBases, secondary) });
  const { cells, removed } = crossCells(strata, DEFAULT_RULES);

  // 4. Answer marginals per primary segment, for the most-tracked statements.
  const statements = [...new Set(inWave.filter((r) => (r[c.group] ?? '').toLowerCase() === spec.primaryGroup.toLowerCase()).map((r) => r[c.statement]!))].slice(0, spec.maxStatements ?? 12);
  const answerMarginal = (segment: string) => {
    const out: Record<string, Record<string, number>> = {};
    // Insertion order follows the source's row order, which is the published response order.
    for (const r of inWave) {
      if ((r[c.group] ?? '').toLowerCase() !== spec.primaryGroup.toLowerCase() || r[c.segment] !== segment) continue;
      const st = r[c.statement]!;
      if (!statements.includes(st)) continue;
      const v = Number(r[c.share]);
      if (!isShare(v)) continue;
      (out[st] ??= {})[r[c.response]!] = v;
    }
    return out;
  };

  const quotaMap = hamiltonAllocate(spec.size, Object.fromEntries(cells.map((x) => [x.key, x.weight])));
  const members: SampledMember[] = [];
  let rejectedDraws = 0;
  for (const cell of cells) {
    const n = quotaMap[cell.key] ?? 0;
    if (n === 0) continue;
    const r = sampleCell(cell, n, answerMarginal(cell.values.age!), spec.seed, DEFAULT_RULES);
    members.push(...r.members);
    rejectedDraws += r.rejected;
  }

  // 5. Calibration targets: segment marginals, and each statement's answer distribution mixed
  //    across segments by the sampled quotas (what an exact sampler would reproduce).
  const targets: Record<string, Record<string, number>> = { age: primaryMarginal };
  if (secondaryDim && secondary.length) targets[secondaryDim] = norm(secondaryBases, secondary);
  const perSegment = Object.fromEntries(primary.map((p) => [p, answerMarginal(p)]));
  const agePop: Record<string, number> = {};
  for (const m of members) agePop[m.pinned.age!] = (agePop[m.pinned.age!] ?? 0) + 1;
  for (const st of statements) {
    const mix: Record<string, number> = {};
    for (const [seg, count] of Object.entries(agePop)) {
      const dist = perSegment[seg]?.[st] ?? {};
      const t = Object.values(dist).reduce((s, v) => s + v, 0) || 1;
      for (const [resp, v] of Object.entries(dist)) mix[resp] = (mix[resp] ?? 0) + (count / members.length) * (v / t);
    }
    targets[st] = mix;
  }
  const calibration = calibrate(members, targets);

  const dims: Record<string, Dimension> = {
    age: { id: 'age', label: spec.primaryGroup, category: 'Demographic', values: primary, defaultValue: null, phrase: 'aged {value}' },
    ...(secondaryDim ? { [secondaryDim]: { id: secondaryDim, label: spec.secondaryGroup!, category: 'Demographic', values: secondary, defaultValue: null } } : {}),
    ...Object.fromEntries(statements.map((st) => [st, { id: st, label: st, category: 'Attitude', values: [], defaultValue: null }])),
  };

  return {
    wave,
    segments: { primary, secondary },
    quotas: cells.map((x) => ({ cell: x.key, weight: Math.round(x.weight * 10000) / 10000, members: quotaMap[x.key] ?? 0 })),
    removedCells: removed,
    statements,
    calibration,
    rejectedDraws,
    examples: members.filter((_, i) => i % Math.max(1, Math.floor(members.length / 5)) === 0).slice(0, 5).map((m) => ({ id: m.id, text: renderMember(m, dims) })),
    assumptions: [
      `Segments are weighted by the bases published for ${wave}; that is the survey sample's composition, not a census population.`,
      'Each member\'s answers are drawn independently per statement from its age segment\'s observed distribution. The databook publishes each statement separately, so correlations between answers are not observed and are not reproduced.',
      ...(secondaryDim && secondary.length ? [`Cells crossing ${spec.primaryGroup} with ${spec.secondaryGroup} assume the two are independent (product of marginals); answers are conditioned on ${spec.primaryGroup} only.`] : []),
      ...[[spec.primaryGroup, primaryBases, primary, primaryPartition.method] as const, ...(secondaryDim && secondary.length ? [[spec.secondaryGroup!, secondaryBases, secondary, secondaryPartition.method] as const] : [])]
        .filter(([, m, kept]) => [...m.keys()].filter((k) => !/^(all|total)$/i.test(k)).length > kept.length)
        .map(([g, m, kept, method]) => {
          const left = [...m.keys()].filter((k) => !kept.includes(k) && !/^(all|total)$/i.test(k));
          return method === 'bases'
            ? `In ${g}, the published segments overlap (some are nets of others). The finest set whose bases add up to the whole sample was kept (${kept.join('; ')}); left out: ${left.join('; ')}.`
            : method === 'bands'
              ? `In ${g}, overlapping bands (${left.join('; ')}) were left out in favour of a non-overlapping set.`
              : `In ${g}, ${left.length} roll-up segment(s) (${left.join('; ')}) were left out by label; the remaining segments were not checked against the total, so some overlap may remain.`;
        }),
      ...(removed.length ? [`${removed.length} impossible cell(s) removed by consistency rules and the rest renormalised.`] : []),
      'Every member is SIMULATED. A member is a draw from published percentages, not a respondent.',
    ],
    members: members.length,
    bases: {
      primary: Object.fromEntries(primary.map((p) => [p, primaryBases.get(p) ?? 0])),
      secondary: Object.fromEntries(secondary.map((p) => [p, secondaryBases.get(p) ?? 0])),
    },
    profiles: Object.fromEntries(
      primary.map((p) => [
        p,
        Object.fromEntries(
          Object.entries(perSegment[p] ?? {}).map(([st, dist]) => [st, Object.entries(dist).map(([response, pct]) => ({ response, pct }))]),
        ),
      ]),
    ),
    cellExamples: Object.fromEntries(
      cells.map((cell) => [cell.key, members.find((m) => m.cell === cell.key)?.drawn ?? {}]).filter(([, d]) => Object.keys(d as object).length > 0),
    ),
  };
}
