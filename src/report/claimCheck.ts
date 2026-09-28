/**
 * The unsupported-claim checker (FR-67, an immutable control).
 *
 * This runs over every claim before it can be exported, and it exists because of one specific
 * failure: a simulation produces fluent, confident prose, and fluent confident prose about
 * "consumers" reads exactly like a research finding. The distance between "nine of twelve simulated
 * personas confirmed" and "consumers prefer X" is one editing pass, and that pass happens after the
 * careful part of the work is over.
 *
 * What it checks is deliberately narrow and mechanical. It is not a judge of whether a claim is
 * *true* — nothing here could be. It catches four things that are checkable:
 *
 *  1. **Figures that are not in the evidence.** A percentage or count that appears in a claim but
 *     nowhere in the run's evidence manifest was invented somewhere between the data and the page.
 *  2. **Language that outranks the evidence grade.** "Proves", "confirms", "demonstrates" attached
 *     to an L3 persona simulation is a category error, whatever the tally.
 *  3. **Generalisation past the sample.** "Consumers", "the market", "people" — where the evidence
 *     describes a panel of simulated personas built from one dataset.
 *  4. **Causal language** over evidence that is cross-sectional and simulated.
 *
 * A blocked claim is not silently rewritten. It is shown to a person with the reason, and they
 * either rewrite it or acknowledge the block by name. Rewriting someone's claim for them would hide
 * the very thing this exists to surface.
 */

export type ClaimIssueKind =
  | 'unsupported_figure'
  | 'overstated_certainty'
  | 'generalisation_beyond_sample'
  | 'causal_language'
  | 'real_world_attribution';

export interface ClaimIssue {
  kind: ClaimIssueKind;
  severity: 'blocking' | 'warning';
  /** The exact text that triggered it, so the writer can find it. */
  excerpt: string;
  message: string;
  suggestion: string;
}

export interface ClaimCheckInput {
  claim: string;
  /** Every figure that appears anywhere in the run's evidence. */
  evidenceFigures: number[];
  evidenceGrade: string;
  /** Tally the claim is entitled to state. */
  panelSize: number;
  isMock: boolean;
}

export interface ClaimCheckResult {
  ok: boolean;
  issues: ClaimIssue[];
}

/** Words that assert the claim has been established, rather than supported to some degree. */
const CERTAINTY = [
  'proves', 'proven', 'proof', 'confirms', 'confirmed', 'demonstrates', 'demonstrated',
  'establishes', 'established', 'shows conclusively', 'definitively', 'certainly', 'undoubtedly',
  'clearly shows', 'without question', 'guarantees', 'guaranteed', 'validates', 'validated',
];

/** Population nouns that reach past the sample the evidence describes. */
const POPULATION = [
  'consumers', 'customers', 'shoppers', 'buyers', 'people', 'the public', 'the market',
  'the population', 'everyone', 'all users', 'audiences', 'society', 'the category',
];

/** Causal verbs, over evidence that is cross-sectional and simulated. */
const CAUSAL = [
  'causes', 'caused', 'causing', 'leads to', 'drives', 'driven by', 'results in', 'resulting in',
  'because of', 'due to', 'makes them', 'produces', 'triggers',
];

/** Phrases asserting that real people did or believe something. */
const REAL_WORLD = [
  'respondents said', 'people told us', 'we found that consumers', 'research shows',
  'the data proves', 'interviews revealed', 'our study found',
];

function findPhrase(
  haystack: string,
  needles: string[],
  exempt?: (lower: string, at: number) => boolean,
): string | null {
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    let at = lower.indexOf(n);
    while (at !== -1) {
      // Word-boundary check for single words, so "cause" does not match inside "because".
      let boundaryOk = true;
      if (!n.includes(' ')) {
        const before = at === 0 ? ' ' : lower[at - 1]!;
        const after = at + n.length >= lower.length ? ' ' : lower[at + n.length]!;
        if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) boundaryOk = false;
      }
      if (boundaryOk && !(exempt?.(lower, at) ?? false)) {
        return haystack.slice(at, at + n.length);
      }
      at = lower.indexOf(n, at + 1);
    }
  }
  return null;
}

/**
 * Phrases where a population noun is not a generalisation.
 *
 * "Worth testing with real people" is the *recommended* wording — it is what this module's own
 * suggestion text tells a writer to use. A checker that blocks the language it recommends teaches
 * people to ignore it, which costs more than the rare false negative this exemption allows.
 *
 * The qualifier must sit immediately before the noun, so "real people" is exempt and "people
 * prefer the premium tier" is not.
 */
const NON_GENERALISING_QUALIFIERS = ['real', 'actual', 'simulated', 'hypothetical', 'synthetic'];

function isQualifiedPopulation(lower: string, at: number): boolean {
  const preceding = lower.slice(Math.max(0, at - 24), at).trimEnd();
  return NON_GENERALISING_QUALIFIERS.some((q) => preceding.endsWith(q));
}

/**
 * Numbers a claim asserts.
 *
 * Years and small counts are skipped: "2026" is a date, and "3 of 12" is a tally the claim is
 * entitled to state. What matters is a figure like "68%" that has to have come from somewhere.
 */
export function figuresIn(text: string, panelSize: number): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    out.push(Number(m[1]));
  }
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\b/g)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    if (n >= 1900 && n <= 2100 && Number.isInteger(n)) continue; // a year
    if (Number.isInteger(n) && n <= panelSize) continue; // a tally the claim may state
    out.push(n);
  }
  return [...new Set(out)];
}

/** Figures match with a small tolerance, because rounding a mean for prose is legitimate. */
function isSupported(figure: number, evidence: number[]): boolean {
  return evidence.some((e) => Math.abs(e - figure) <= Math.max(0.5, Math.abs(e) * 0.01));
}

export function checkClaim(input: ClaimCheckInput): ClaimCheckResult {
  const issues: ClaimIssue[] = [];
  const { claim } = input;

  // 1. Figures with no source.
  for (const figure of figuresIn(claim, input.panelSize)) {
    if (!isSupported(figure, input.evidenceFigures)) {
      issues.push({
        kind: 'unsupported_figure',
        severity: 'blocking',
        excerpt: String(figure),
        message:
          `The figure ${figure} does not appear anywhere in this run's evidence. It was introduced ` +
          'somewhere between the data and this sentence.',
        suggestion:
          'Quote a figure that is in the evidence, or state the finding without a number.',
      });
    }
  }

  // 2. Certainty the grade does not support.
  const certainty = findPhrase(claim, CERTAINTY);
  if (certainty) {
    issues.push({
      kind: 'overstated_certainty',
      severity: 'blocking',
      excerpt: certainty,
      message:
        `"${certainty}" asserts the claim has been established. This finding is graded ` +
        `${input.evidenceGrade.replace(/_/g, ' ').toLowerCase()} — a simulation of personas built ` +
        'from one dataset. It can support a claim; it cannot establish one.',
      suggestion:
        'Say what the run found and how strongly: "the panel largely supported…", "the evidence is ' +
        'consistent with…", "this is worth testing with real people".',
    });
  }

  // 3. Reaching past the sample.
  const population = findPhrase(claim, POPULATION, isQualifiedPopulation);
  if (population) {
    issues.push({
      kind: 'generalisation_beyond_sample',
      severity: 'blocking',
      excerpt: population,
      message:
        `"${population}" describes a population. The evidence describes a panel of ` +
        `${input.panelSize} simulated personas built from one dataset, which is not the same thing ` +
        'and does not stand in for it.',
      suggestion:
        'Name what was actually observed: "the simulated panel", "respondents in this dataset", ' +
        'or the specific segment.',
    });
  }

  // 4. Causation from cross-sectional, simulated material.
  const causal = findPhrase(claim, CAUSAL);
  if (causal) {
    issues.push({
      kind: 'causal_language',
      severity: 'warning',
      excerpt: causal,
      message:
        `"${causal}" asserts cause. This evidence is cross-sectional and simulated: it can show ` +
        'that two things occur together, not that one produces the other.',
      suggestion: 'Use "is associated with", "occurs alongside", or state the association plainly.',
    });
  }

  // 5. Attributing the result to real people.
  const realWorld = findPhrase(claim, REAL_WORLD);
  if (realWorld) {
    issues.push({
      kind: 'real_world_attribution',
      severity: 'blocking',
      excerpt: realWorld,
      message:
        `"${realWorld}" attributes this to real people. Nobody was asked. These are simulated ` +
        'personas answering from a dataset.',
      suggestion: 'Attribute it to the simulation: "the simulated panel", "in this run".',
    });
  }

  // 6. A mock run cannot support any claim at all.
  if (input.isMock) {
    issues.push({
      kind: 'real_world_attribution',
      severity: 'blocking',
      excerpt: '(whole claim)',
      message:
        'This run used the mock provider. No model was consulted, so the outputs are placeholders ' +
        'and no claim can rest on them.',
      suggestion: 'Re-run with a configured model provider before exporting any claim.',
    });
  }

  return { ok: issues.filter((i) => i.severity === 'blocking').length === 0, issues };
}

/** Every figure in a run's evidence, for the checker to compare against. */
export function collectEvidenceFigures(
  fields: { numeric: { min: number; max: number; mean: number; median: number; sd: number } | null; topValues: { count: number }[]; baseSize: number | null }[],
  rowCount: number,
): number[] {
  const out: number[] = [rowCount];
  for (const f of fields) {
    if (f.baseSize !== null) out.push(f.baseSize);
    for (const t of f.topValues) {
      out.push(t.count);
      // The share a value represents, which is what prose usually quotes.
      if (f.baseSize) out.push(Math.round((t.count / f.baseSize) * 1000) / 10);
    }
    if (f.numeric) {
      out.push(f.numeric.min, f.numeric.max, f.numeric.mean, f.numeric.median, f.numeric.sd);
      out.push(Math.round(f.numeric.mean * 10) / 10);
    }
  }
  return [...new Set(out.filter((n) => Number.isFinite(n)))];
}

/** Shown above the checker's results. */
export const CLAIM_CHECK_NOTICE =
  'This check is mechanical. It catches figures with no source, language that claims more than a ' +
  'simulation can support, and generalisation past the sample. It cannot tell you whether a claim ' +
  'is true — that judgement is yours, and it is not one this software will make for you.';
