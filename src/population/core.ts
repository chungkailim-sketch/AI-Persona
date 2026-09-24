/**
 * Population-scale sampling, adapted from MatrAIx's persona infrastructure (MIT code;
 * github.com/MatrAIx-ai/MatrAIx-Persona-8B) and bound to this product's evidence rules.
 *
 * What is taken from MatrAIx: the categorical dimension format (id, label, category, values,
 * default, phrase); seeded forward sampling in a fixed order with pins; hard masks from consistency
 * rules with reject-and-redraw; stratified cells weighted by the product of per-dimension marginals
 * and sized by largest-remainder (Hamilton) allocation; a calibration report comparing sampled with
 * target marginals; and section-grouped, budget-trimmed persona rendering.
 *
 * What is deliberately not taken: their 1M persona dataset (research-only licence) and their
 * dependency graph (mostly schema-assumed edges). Every distribution here comes from the project's
 * own ingested data, and every sampled member is SIMULATED: its answers are drawn from OBSERVED
 * segment marginals, but the joint structure between answers is not observed — cross-tabs publish
 * each question separately — so members are conditionally independent given their segment.
 */
import { seededRandom, hashToInt } from '@/model/provider';

// ── Schema ─────────────────────────────────────────────────────────────────────

export interface Dimension {
  id: string;
  label: string;
  category: string;
  /** Ordered where the source is ordinal (Likert bands). */
  values: string[];
  defaultValue: string | null;
  /** Rendering template, e.g. "aged {value}". */
  phrase?: string;
}

/** A categorical distribution over a dimension's values, with the base it was measured on. */
export interface Marginal {
  dimension: string;
  probabilities: Record<string, number>;
  base: number | null;
  origin: 'OBSERVED' | 'DERIVED';
}

// ── Quotas ─────────────────────────────────────────────────────────────────────

/**
 * Largest-remainder (Hamilton) allocation: integers summing exactly to `total`, as close to
 * proportional as integers allow. Ties break by key order, so the result is deterministic.
 */
export function hamiltonAllocate(total: number, weights: Record<string, number>): Record<string, number> {
  const keys = Object.keys(weights).filter((k) => weights[k]! > 0);
  const sum = keys.reduce((s, k) => s + weights[k]!, 0);
  const out: Record<string, number> = Object.fromEntries(Object.keys(weights).map((k) => [k, 0]));
  if (total <= 0 || sum <= 0) return out;
  const exact = keys.map((k) => ({ k, q: (weights[k]! / sum) * total }));
  let assigned = 0;
  for (const e of exact) {
    out[e.k] = Math.floor(e.q);
    assigned += out[e.k]!;
  }
  exact
    .map((e, i) => ({ ...e, r: e.q - Math.floor(e.q), i }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .slice(0, total - assigned)
    .forEach((e) => (out[e.k]! += 1));
  return out;
}

export interface CellSpec {
  key: string;
  /** The value of each stratifying dimension in this cell. */
  values: Record<string, string>;
  weight: number;
}

/**
 * Cells as the cross-product of stratifying dimensions, each weighted by the product of its
 * per-dimension marginals — the independence assumption, stated as such — with impossible cells
 * removed by the consistency rules and the rest renormalised.
 */
export function crossCells(
  strata: { dimension: string; marginal: Record<string, number> }[],
  rules: readonly ConsistencyRule[] = [],
): { cells: CellSpec[]; removed: string[] } {
  let cells: CellSpec[] = [{ key: '', values: {}, weight: 1 }];
  for (const s of strata) {
    const next: CellSpec[] = [];
    for (const c of cells) {
      for (const [v, p] of Object.entries(s.marginal)) {
        if (p <= 0) continue;
        next.push({ key: c.key ? `${c.key} × ${v}` : v, values: { ...c.values, [s.dimension]: v }, weight: c.weight * p });
      }
    }
    cells = next;
  }
  const removed: string[] = [];
  const kept = cells.filter((c) => {
    const v = validate(c.values, rules);
    if (v.length) removed.push(c.key);
    return v.length === 0;
  });
  const total = kept.reduce((s, c) => s + c.weight, 0) || 1;
  return { cells: kept.map((c) => ({ ...c, weight: c.weight / total })), removed };
}

// ── Consistency rules (MatrAIx `validate_dimensions`, as data) ──────────────────

export interface ConsistencyRule {
  when: { dimension: string; values: string[] };
  forbid: { dimension: string; values: string[] };
  reason: string;
}

/**
 * A rule value matches a label exactly or as its leading word(s), case-insensitively, so a rule
 * on "Retired" also covers a databook's "Retired/pensioner".
 */
function matches(label: string, ruleValues: readonly string[]): boolean {
  const l = label.trim().toLowerCase();
  return ruleValues.some((v) => {
    const r = v.toLowerCase();
    return l === r || (l.startsWith(r) && /[^a-z0-9]/.test(l.charAt(r.length)));
  });
}

export function validate(values: Record<string, string>, rules: readonly ConsistencyRule[]): string[] {
  const problems: string[] = [];
  for (const r of rules) {
    const a = values[r.when.dimension];
    const b = values[r.forbid.dimension];
    if (a !== undefined && b !== undefined && matches(a, r.when.values) && matches(b, r.forbid.values)) problems.push(r.reason);
  }
  return problems;
}

/**
 * Rules for demographic breaks that appear in consumer databooks. Written as impossibilities or
 * near-impossibilities only — a rule that encodes a stereotype rather than a constraint is a bias.
 */
export const DEFAULT_RULES: ConsistencyRule[] = [
  { when: { dimension: 'age', values: ['18-24'] }, forbid: { dimension: 'employment', values: ['Retired'] }, reason: 'Retired at 18-24 is implausible in a general-population panel.' },
  { when: { dimension: 'age', values: ['55+', '55-64', '65+'] }, forbid: { dimension: 'employment', values: ['Student', 'In full-time education'] }, reason: 'Full-time education at 55+ is rare enough to exclude from synthetic cells.' },
  { when: { dimension: 'age', values: ['18-24'] }, forbid: { dimension: 'parental_status', values: ['Has grandchildren'] }, reason: 'Grandparent at 18-24 is implausible.' },
];

// ── Sampling ───────────────────────────────────────────────────────────────────

export interface SampledMember {
  id: string;
  cell: string;
  /** Stratifying values (pinned) — OBSERVED segment membership. */
  pinned: Record<string, string>;
  /** Drawn answers — SIMULATED, from OBSERVED marginals. */
  drawn: Record<string, string>;
}

function draw(probs: Record<string, number>, u: number): string {
  const entries = Object.entries(probs).filter(([, p]) => p > 0);
  const total = entries.reduce((s, [, p]) => s + p, 0);
  let acc = 0;
  for (const [v, p] of entries) {
    acc += p / total;
    if (u < acc) return v;
  }
  return entries[entries.length - 1]?.[0] ?? '';
}

/**
 * Draw `n` members for one cell. Order is fixed (dimensions sorted by id), the generator is seeded
 * from (seed, cell, index), and a draw that breaks a rule is redrawn up to `maxRetries` times —
 * so the same inputs always give the same population.
 */
export function sampleCell(
  cell: CellSpec,
  n: number,
  marginals: Record<string, Record<string, number>>,
  seed: number,
  rules: readonly ConsistencyRule[] = [],
  maxRetries = 20,
): { members: SampledMember[]; rejected: number } {
  const dims = Object.keys(marginals).sort();
  const members: SampledMember[] = [];
  let rejected = 0;
  for (let i = 0; i < n; i += 1) {
    const rng = seededRandom((hashToInt(`${cell.key}#${i}`) ^ seed) >>> 0);
    let drawn: Record<string, string> = {};
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      drawn = {};
      for (const d of dims) drawn[d] = draw(marginals[d]!, rng());
      if (validate({ ...cell.values, ...drawn }, rules).length === 0) break;
      rejected += 1;
    }
    members.push({ id: `${cell.key || 'all'}-${String(i + 1).padStart(4, '0')}`, cell: cell.key, pinned: cell.values, drawn });
  }
  return { members, rejected };
}

// ── Calibration (MatrAIx's marginal-error check) ────────────────────────────────

export interface CalibrationRow {
  dimension: string;
  maxAbsErrorPp: number;
  worstValue: string;
}

export function calibrate(members: readonly SampledMember[], targets: Record<string, Record<string, number>>): CalibrationRow[] {
  return Object.entries(targets).map(([dim, target]) => {
    const counts: Record<string, number> = {};
    for (const m of members) {
      const v = m.drawn[dim] ?? m.pinned[dim];
      if (v !== undefined) counts[v] = (counts[v] ?? 0) + 1;
    }
    const n = Object.values(counts).reduce((s, c) => s + c, 0) || 1;
    const tsum = Object.values(target).reduce((s, p) => s + p, 0) || 1;
    let worst = '';
    let max = 0;
    for (const v of new Set([...Object.keys(target), ...Object.keys(counts)])) {
      const e = Math.abs((counts[v] ?? 0) / n - (target[v] ?? 0) / tsum) * 100;
      if (e > max) { max = e; worst = v; }
    }
    return { dimension: dim, maxAbsErrorPp: Math.round(max * 100) / 100, worstValue: worst };
  });
}

// ── Roll-up with honest intervals ───────────────────────────────────────────────

/** Wilson score interval for a proportion, in percent. */
export function wilson(successes: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: 0, lo: 0, hi: 0 };
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const f = (x: number) => Math.round(x * 1000) / 10;
  return { p: f(p), lo: f((c - r) / d), hi: f((c + r) / d) };
}

/**
 * Weighted share of `stance` across personas, each weighted by its segment's share of the sample.
 * Weighting by the survey sample is not weighting by the population; the caller's label must say so.
 */
export function weightedShare(items: readonly { weight: number; value: string | null }[], target: string): number | null {
  const valid = items.filter((i) => i.value !== null && i.weight > 0);
  const w = valid.reduce((s, i) => s + i.weight, 0);
  if (w === 0) return null;
  return Math.round((valid.filter((i) => i.value === target).reduce((s, i) => s + i.weight, 0) / w) * 1000) / 10;
}

// ── Rendering (MatrAIx `build_dimension_narrative`, with provenance kept) ────────

const NULLISH = new Set(['', 'none', 'n/a', 'na', 'prefer not to say', "don't know", 'not applicable']);

export function renderMember(
  member: SampledMember,
  dims: Record<string, Dimension>,
  budgetChars = 1200,
): string {
  const lines: string[] = ['Segment membership (observed):'];
  for (const [k, v] of Object.entries(member.pinned)) lines.push(`- ${dims[k]?.label ?? k}: ${v}`);
  const drawn = Object.entries(member.drawn).filter(([k, v]) => !NULLISH.has(v.trim().toLowerCase()) && v !== dims[k]?.defaultValue);
  if (drawn.length) lines.push('Simulated answers (drawn from this segment\'s observed distribution; not a real respondent):');
  let shown = 0;
  for (const [k, v] of drawn) {
    const line = `- ${dims[k]?.label ?? k}: ${v}`;
    if (lines.join('\n').length + line.length + 1 > budgetChars) break;
    lines.push(line);
    shown += 1;
  }
  if (shown < drawn.length) lines.push(`- … ${drawn.length - shown} more omitted for length`);
  return lines.join('\n');
}
