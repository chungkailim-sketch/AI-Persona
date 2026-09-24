/**
 * Anti-herding measurement.
 *
 * A panel of simulated personas agreeing is worth almost nothing on its own. They share a model, a
 * prompt and a corpus, so agreement is the *expected* outcome whether or not the claim is true.
 * These metrics measure whether the disagreement in a run is real, and the report shows them beside
 * every finding so that "all twelve personas agreed" cannot be read as twelve independent
 * confirmations.
 *
 * Three quantities, each catching a different failure:
 *
 *  - **Entropy** of the final stance distribution. Near zero means the panel converged on one
 *    answer; near one means it split.
 *  - **Capitulation rate**: of the personas who did NOT initially hold the view the panel ended on,
 *    the share that moved to it. This, not the raw flip rate, is the quantity that detects herding.
 *    The raw flip rate cannot exceed `1 − initial majority share`, so a panel where a third already
 *    held the eventual view can converge *completely* and still show a flip rate of only 0.67 — the
 *    threshold would never fire in precisely the case it exists to catch. Capitulation is measured
 *    against what could have moved, so total convergence always reads as 1.0.
 *  - **Independent agreement**: how much agreement existed *before* anyone saw another view. This
 *    is the only agreement that carries information, because it is the only agreement that was not
 *    produced by exposure.
 *
 * The thresholds come from the `autoresearch` method that preceded this platform — above 0.8
 * combined with entropy below 0.3 is flagged as herding rather than consensus. The 0.8 is applied
 * to capitulation rather than to the raw flip rate, for the reason given above; applying it to the
 * raw rate as originally specified makes the check almost unfireable.
 */
import type { Stance } from '@/run/schemas';

export const HERD_THRESHOLDS = {
  /** Applied to the capitulation rate, not the raw flip rate. See the note above. */
  capitulation: 0.8,
  entropy: 0.3,
  /** Below this, a "consensus" is too small a panel to mean anything. */
  minimumPanel: 3,
} as const;

export interface AntiHerdInput {
  /** One entry per persona, in a stable order. */
  independent: Stance[];
  final: Stance[];
}

export interface AntiHerdResult {
  panelSize: number;
  entropy: number;
  /** Raw share who changed position. Reported, but not what the detection rests on. */
  flipRate: number;
  /** Of those who could have moved to the final majority view, the share that did. */
  capitulationRate: number;
  independentAgreement: number;
  finalAgreement: number;
  herdingSuspected: boolean;
  /** Written for a reader of the report, not for a log. */
  interpretation: string;
}

/** Shannon entropy over the stance distribution, normalised to 0–1. */
export function stanceEntropy(stances: readonly Stance[]): number {
  if (stances.length === 0) return 0;
  const counts = new Map<Stance, number>();
  for (const s of stances) counts.set(s, (counts.get(s) ?? 0) + 1);

  const total = stances.length;
  const raw = -[...counts.values()]
    .map((c) => c / total)
    .reduce((sum, p) => sum + (p > 0 ? p * Math.log(p) : 0), 0);

  // Three possible stances, so the maximum entropy is ln(3). The `+ 0` turns -0 into 0: a negated
  // sum of zeros is -0 in JavaScript, which is correct arithmetic and an eyesore in a report.
  return Math.min(1, raw / Math.log(3)) + 0;
}

/** The most common stance, with ties broken by first appearance so the result is deterministic. */
export function modalStance(stances: readonly Stance[]): Stance | null {
  if (stances.length === 0) return null;
  const counts = new Map<Stance, number>();
  for (const s of stances) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best: Stance = stances[0]!;
  let bestCount = -1;
  for (const s of stances) {
    const c = counts.get(s) ?? 0;
    if (c > bestCount) { best = s; bestCount = c; }
  }
  return best;
}

/** The share holding the most common stance. */
export function agreementShare(stances: readonly Stance[]): number {
  if (stances.length === 0) return 0;
  const counts = new Map<Stance, number>();
  for (const s of stances) counts.set(s, (counts.get(s) ?? 0) + 1);
  return Math.max(...counts.values()) / stances.length;
}

export function measureAntiHerd(input: AntiHerdInput): AntiHerdResult {
  const panelSize = Math.min(input.independent.length, input.final.length);
  if (panelSize === 0) {
    return {
      panelSize: 0,
      entropy: 0,
      flipRate: 0,
      capitulationRate: 0,
      independentAgreement: 0,
      finalAgreement: 0,
      herdingSuspected: false,
      interpretation: 'No personas responded, so there is nothing to measure.',
    };
  }

  const independent = input.independent.slice(0, panelSize);
  const final = input.final.slice(0, panelSize);

  const flips = independent.filter((s, i) => s !== final[i]).length;
  const flipRate = flips / panelSize;
  const entropy = stanceEntropy(final);
  const independentAgreement = agreementShare(independent);
  const finalAgreement = agreementShare(final);

  // Of those who did not already hold the eventual majority view, how many ended up holding it.
  const endedOn = modalStance(final);
  const couldMove = independent.filter((s) => s !== endedOn).length;
  const moved = independent.filter((s, i) => s !== endedOn && final[i] === endedOn).length;
  const capitulationRate = couldMove === 0 ? 0 : moved / couldMove;

  const herdingSuspected =
    panelSize >= HERD_THRESHOLDS.minimumPanel &&
    capitulationRate >= HERD_THRESHOLDS.capitulation &&
    couldMove > 0 &&
    entropy < HERD_THRESHOLDS.entropy;

  let interpretation: string;
  if (panelSize < HERD_THRESHOLDS.minimumPanel) {
    interpretation =
      `Only ${panelSize} persona(s) responded. That is too small a panel for agreement to carry ` +
      'any information at all.';
  } else if (herdingSuspected) {
    interpretation =
      `${Math.round(capitulationRate * 100)}% of the personas who initially disagreed with the ` +
      'eventual majority abandoned their position after seeing the others, leaving the panel almost ' +
      `unanimous (entropy ${entropy.toFixed(2)}). That is the signature of herding rather than of ` +
      'reasoning: treat this consensus as one view held by many, not as independent confirmation.';
  } else if (independentAgreement >= 0.9 && flipRate < 0.2) {
    interpretation =
      `${Math.round(independentAgreement * 100)}% agreed before seeing any other view, and few ` +
      'changed afterwards. That agreement was not produced by exposure — though the personas ' +
      'still share a model and a corpus, so it is not independent evidence either.';
  } else if (entropy >= 0.6) {
    interpretation =
      `The panel remained genuinely split (entropy ${entropy.toFixed(2)}). The disagreement is ` +
      'itself the finding, and a single headline would misrepresent it.';
  } else {
    interpretation =
      `${Math.round(finalAgreement * 100)}% converged on one position, with ` +
      `${Math.round(flipRate * 100)}% changing along the way. Agreement among simulated personas ` +
      'is weak evidence: they share a model and a corpus.';
  }

  return {
    panelSize,
    entropy: Math.round(entropy * 1000) / 1000,
    flipRate: Math.round(flipRate * 1000) / 1000,
    capitulationRate: Math.round(capitulationRate * 1000) / 1000,
    independentAgreement: Math.round(independentAgreement * 1000) / 1000,
    finalAgreement: Math.round(finalAgreement * 1000) / 1000,
    herdingSuspected,
    interpretation,
  };
}

/**
 * How many personas must challenge, for the challenge round to be worth running.
 *
 * At least half, and never fewer than one. A challenge round where a token minority objects is
 * theatre: it produces a dissent line in the report without ever having put the majority view under
 * pressure.
 */
export function requiredChallengers(panelSize: number): number {
  return Math.max(1, Math.ceil(panelSize / 2));
}
