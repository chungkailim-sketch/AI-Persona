/**
 * Persona adherence — the contrast test, adapted from MatrAIx's trait-adherence check.
 *
 * Question: does a persona answer the way the segment it describes answered? Take a statement on
 * which segments' majorities differ. Put up to five personas whose segment mostly agreed ("with the
 * trait") and up to five whose segment mostly did not ("without") to the same probe. The cohort
 * passes if at least 80% on EACH side answer in line with their own segment (MatrAIx: ≥4 of 5).
 * Testing both sides matters: a model that agrees with everything passes one side and fails the other.
 *
 * This is pure logic; the model calls live in `adherenceService.ts`.
 */
export type ProbeAnswer = 'agree' | 'disagree' | 'neither';

/** Share (percent) of a published distribution that agrees, from "Strongly agree 19% · …". */
export function agreeShare(value: string): number | null {
  const parts = [...value.matchAll(/([^·()]+?)\s+(\d+(?:\.\d+)?)%/g)];
  if (parts.length < 2) return null;
  let agree = 0;
  let total = 0;
  for (const [, label, pct] of parts) {
    const l = label!.trim().toLowerCase();
    const v = Number(pct);
    total += v;
    if (/\bagree\b/.test(l) && !/disagree/.test(l) && !/neither/.test(l)) agree += v;
  }
  return total > 0 ? Math.round((agree / total) * 1000) / 10 : null;
}

export interface AdherencePersona {
  key: string;
  segment: string;
  attributes: { label: string; value: string; origin: string }[];
}

export interface ContrastPlan {
  statement: string;
  withTrait: { key: string; agreePct: number }[];
  withoutTrait: { key: string; agreePct: number }[];
  spreadPp: number;
}

/**
 * The statement with the widest agree-share spread among those that split segment majorities, and
 * up to `perSide` personas per side (one per segment, most extreme first). Null when no statement
 * splits majorities — then there is nothing to contrast.
 */
export function chooseContrast(personas: readonly AdherencePersona[], perSide = 5): ContrastPlan | null {
  const bySegment = new Map<string, AdherencePersona>();
  for (const p of personas) if (!bySegment.has(p.segment)) bySegment.set(p.segment, p);
  const unique = [...bySegment.values()];
  const statements = new Set(unique.flatMap((p) => p.attributes.filter((a) => a.origin === 'OBSERVED').map((a) => a.label)));

  let best: ContrastPlan | null = null;
  for (const st of statements) {
    const rows = unique
      .map((p) => ({ key: p.key, agreePct: agreeShare(p.attributes.find((a) => a.label === st && a.origin === 'OBSERVED')?.value ?? '') }))
      .filter((r): r is { key: string; agreePct: number } => r.agreePct !== null);
    const hi = rows.filter((r) => r.agreePct >= 50).sort((a, b) => b.agreePct - a.agreePct);
    const lo = rows.filter((r) => r.agreePct < 50).sort((a, b) => a.agreePct - b.agreePct);
    if (hi.length === 0 || lo.length === 0) continue;
    const spread = hi[0]!.agreePct - lo[0]!.agreePct;
    const size = Math.min(hi.length, perSide) + Math.min(lo.length, perSide);
    const bestSize = best ? best.withTrait.length + best.withoutTrait.length : -1;
    if (!best || size > bestSize || (size === bestSize && spread > best.spreadPp)) {
      best = { statement: st, withTrait: hi.slice(0, perSide), withoutTrait: lo.slice(0, perSide), spreadPp: Math.round(spread * 10) / 10 };
    }
  }
  return best;
}

export interface AdherenceOutcome {
  status: 'pass' | 'fail' | 'not_applicable' | 'not_evaluated';
  statement: string | null;
  withTrait: { key: string; agreePct: number; answer: ProbeAnswer | null; inLine: boolean }[];
  withoutTrait: { key: string; agreePct: number; answer: ProbeAnswer | null; inLine: boolean }[];
  threshold: number;
  reason: string;
}

export const ADHERENCE_THRESHOLD = 0.8;

export function scoreContrast(plan: ContrastPlan, answers: Record<string, ProbeAnswer | null>): AdherenceOutcome {
  const mark = (side: ContrastPlan['withTrait'], expectAgree: boolean) =>
    side.map((p) => {
      const answer = answers[p.key] ?? null;
      return { ...p, answer, inLine: answer !== null && (expectAgree ? answer === 'agree' : answer !== 'agree') };
    });
  const withTrait = mark(plan.withTrait, true);
  const withoutTrait = mark(plan.withoutTrait, false);
  const rate = (xs: { inLine: boolean }[]) => (xs.length ? xs.filter((x) => x.inLine).length / xs.length : 0);
  const a = rate(withTrait);
  const b = rate(withoutTrait);
  const pass = a >= ADHERENCE_THRESHOLD && b >= ADHERENCE_THRESHOLD;
  const f = (xs: { inLine: boolean }[]) => `${xs.filter((x) => x.inLine).length}/${xs.length}`;
  return {
    status: pass ? 'pass' : 'fail',
    statement: plan.statement,
    withTrait,
    withoutTrait,
    threshold: ADHERENCE_THRESHOLD,
    reason: pass
      ? `Personas answered in line with their segment on both sides (${f(withTrait)} with the trait, ${f(withoutTrait)} without).`
      : `Below ${ADHERENCE_THRESHOLD * 100}% on at least one side (${f(withTrait)} with the trait, ${f(withoutTrait)} without). ` +
        (a >= ADHERENCE_THRESHOLD && b < ADHERENCE_THRESHOLD ? 'Personas whose segment disagreed still agreed — a sign of agreeable drift rather than adherence.' : 'Personas are not reliably reproducing their segment\'s position.'),
  };
}
