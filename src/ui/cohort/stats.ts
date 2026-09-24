/**
 * Cohort statistics, computed from stored personas only. Every figure here is arithmetic over
 * attributes that already carry their provenance; nothing is inferred, and no sensitive attribute
 * can appear because excluded fields never became attributes in the first place.
 */
export interface StatPersona {
  name: string;
  segment: string | null;
  baseSize: number | null;
  weight: number;
  confidence: string;
  approval: string;
  contradictions?: number;
  attributes: { origin: string; group: string }[];
}

export interface CohortStats {
  total: number;
  approved: number;
  pending: number;
  excluded: number;
  weakEvidence: number;
  conflicting: number;
  segments: number;
  /** Share of the sample the cohort's distinct segments cover, 0..1. Null when weights are unknown. */
  sampleCoverage: number | null;
  /** Share of all attributes that were observed or derived, 0..1. */
  dataCoverage: number;
  confidence: { HIGH: number; MEDIUM: number; LOW: number };
  provenance: Record<string, number>;
}

export function cohortStats(personas: StatPersona[]): CohortStats {
  const seen = new Map<string, number>();
  let grounded = 0;
  let attrs = 0;
  const provenance: Record<string, number> = {};
  const confidence = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const p of personas) {
    if (p.segment && !seen.has(p.segment)) seen.set(p.segment, p.weight);
    const c = (p.confidence in confidence ? p.confidence : 'LOW') as keyof typeof confidence;
    confidence[c] += 1;
    for (const a of p.attributes) {
      attrs += 1;
      provenance[a.origin] = (provenance[a.origin] ?? 0) + 1;
      if (a.origin === 'OBSERVED' || a.origin === 'DERIVED') grounded += 1;
    }
  }
  const weights = [...seen.values()];
  return {
    total: personas.length,
    approved: personas.filter((p) => p.approval === 'APPROVED').length,
    pending: personas.filter((p) => p.approval === 'CANDIDATE' || p.approval === 'DRAFT').length,
    excluded: personas.filter((p) => p.approval === 'EXCLUDED').length,
    weakEvidence: personas.filter((p) => p.confidence === 'LOW').length,
    conflicting: personas.filter((p) => (p.contradictions ?? 0) > 0).length,
    segments: seen.size,
    sampleCoverage: weights.length ? Math.min(1, weights.reduce((s, w) => s + w, 0)) : null,
    dataCoverage: attrs ? grounded / attrs : 0,
    confidence,
    provenance,
  };
}

export function groundedShare(p: StatPersona): number | null {
  if (p.attributes.length === 0) return null;
  return p.attributes.filter((a) => a.origin === 'OBSERVED' || a.origin === 'DERIVED').length / p.attributes.length;
}
