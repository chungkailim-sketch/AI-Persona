/**
 * Dataset quality score.
 *
 * The score is a summary, and a summary can be leaned on too hard. Two things stop that here: the
 * five components are always shown alongside the total with their weights, and each carries a
 * written explanation of what produced it. A single number with no components would invite "84,
 * fine" — which is exactly the reading the evidence hierarchy exists to prevent.
 *
 * Nothing here judges whether the data answers the question. That is the construct-mapping grade,
 * which a person assigns; a well-formed file measuring the wrong thing scores highly and is still
 * the wrong evidence.
 */
export interface QualityComponentResult {
  key: 'completeness' | 'sample_adequacy' | 'recency' | 'documentation' | 'structural_integrity';
  label: string;
  score: number;
  weight: number;
  explanation: string;
}

export interface QualityInput {
  fields: { missingPct: number; type: string; typeConfidence: number }[];
  rowCount: number;
  /** From the governance record, when one exists at scoring time. */
  collectionEnd: Date | null;
  hasGovernance: boolean;
  documentedFieldShare: number;
  blockingFindings: number;
  warningFindings: number;
}

const WEIGHTS = {
  completeness: 0.3,
  sample_adequacy: 0.2,
  recency: 0.2,
  documentation: 0.15,
  structural_integrity: 0.15,
} as const;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function scoreQuality(input: QualityInput): {
  total: number;
  components: QualityComponentResult[];
} {
  const components: QualityComponentResult[] = [];

  const avgMissing =
    input.fields.length === 0
      ? 100
      : input.fields.reduce((s, f) => s + f.missingPct, 0) / input.fields.length;
  components.push({
    key: 'completeness',
    label: 'Completeness',
    score: clamp(100 - avgMissing * 1.5),
    weight: WEIGHTS.completeness,
    explanation:
      input.fields.length === 0
        ? 'No fields were profiled.'
        : `Average missingness across ${input.fields.length} fields is ${avgMissing.toFixed(1)}%.`,
  });

  // Rough and deliberately conservative: a few hundred rows supports description, not subgroup
  // comparison. The explanation says which, so the number is not read as a licence.
  const n = input.rowCount;
  const sampleScore = n >= 1000 ? 100 : n >= 400 ? 80 : n >= 150 ? 60 : n >= 50 ? 35 : 10;
  components.push({
    key: 'sample_adequacy',
    label: 'Sample adequacy',
    score: sampleScore,
    weight: WEIGHTS.sample_adequacy,
    explanation:
      n >= 400
        ? `${n.toLocaleString()} rows. Adequate for subgroup comparison if the subgroups are not small.`
        : n >= 150
          ? `${n.toLocaleString()} rows. Enough to describe the whole sample; too few to split confidently.`
          : `${n.toLocaleString()} rows. Descriptive only — any breakdown will rest on very small bases.`,
  });

  let recencyScore = 40;
  let recencyText = 'No collection period recorded, so recency cannot be assessed.';
  if (input.collectionEnd) {
    const months =
      (Date.now() - input.collectionEnd.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    recencyScore = months <= 6 ? 100 : months <= 12 ? 85 : months <= 24 ? 60 : months <= 36 ? 35 : 15;
    recencyText = `Collection ended about ${Math.round(months)} months ago.`;
  }
  components.push({
    key: 'recency',
    label: 'Recency',
    score: recencyScore,
    weight: WEIGHTS.recency,
    explanation: recencyText,
  });

  const docScore = clamp(
    (input.hasGovernance ? 55 : 0) + input.documentedFieldShare * 45,
  );
  components.push({
    key: 'documentation',
    label: 'Documentation',
    score: docScore,
    weight: WEIGHTS.documentation,
    explanation: input.hasGovernance
      ? `Provenance recorded; ${Math.round(input.documentedFieldShare * 100)}% of fields have a confident type.`
      : 'No governance record yet: source, methodology and lawful basis are unstated.',
  });

  const structural = clamp(100 - input.blockingFindings * 40 - input.warningFindings * 10);
  components.push({
    key: 'structural_integrity',
    label: 'Structural integrity',
    score: structural,
    weight: WEIGHTS.structural_integrity,
    explanation:
      input.blockingFindings + input.warningFindings === 0
        ? 'No integrity problems detected.'
        : `${input.blockingFindings} blocking and ${input.warningFindings} warning finding(s).`,
  });

  const total = clamp(components.reduce((s, c) => s + c.score * c.weight, 0));
  return { total, components };
}

/** Shown wherever the score is shown. */
export const QUALITY_CAVEAT =
  'This score describes the condition of the file, not whether it answers your question. A ' +
  'well-formed dataset measuring the wrong thing scores highly.';
