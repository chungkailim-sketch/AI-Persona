import { describe, it, expect } from 'vitest';
import {
  measureAntiHerd,
  stanceEntropy,
  agreementShare,
  requiredChallengers,
  HERD_THRESHOLDS,
} from '@/run/antiHerd';
import type { Stance } from '@/run/schemas';

const C: Stance = 'confirm';
const D: Stance = 'dispute';
const A: Stance = 'abstain';

describe('entropy', () => {
  it('is zero when everyone says the same thing', () => {
    expect(stanceEntropy([C, C, C, C])).toBe(0);
  });

  it('is one when the panel splits evenly across all three stances', () => {
    expect(stanceEntropy([C, D, A, C, D, A])).toBeCloseTo(1, 5);
  });

  it('sits in between for a partial split', () => {
    const e = stanceEntropy([C, C, C, D]);
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(1);
  });

  it('is zero for an empty panel rather than undefined', () => {
    expect(stanceEntropy([])).toBe(0);
  });
});

describe('agreement share', () => {
  it('reports the share holding the most common stance', () => {
    expect(agreementShare([C, C, C, D])).toBe(0.75);
    expect(agreementShare([C, D])).toBe(0.5);
  });
});

describe('herding detection', () => {
  it('flags the case it exists for: everyone moved, then everyone agreed', () => {
    // Nine personas disagree independently, then all converge after seeing each other. The tally
    // looks like consensus and is the opposite of it.
    const independent: Stance[] = [C, D, A, D, C, D, A, D, C];
    const final: Stance[] = [C, C, C, C, C, C, C, C, C];

    const r = measureAntiHerd({ independent, final });
    // The raw flip rate is only 0.67 here, because three personas already held the eventual view.
    // Measured against what could actually move, every dissenter capitulated.
    expect(r.flipRate).toBeLessThan(HERD_THRESHOLDS.capitulation);
    expect(r.capitulationRate).toBe(1);
    expect(r.entropy).toBeLessThan(HERD_THRESHOLDS.entropy);
    expect(r.herdingSuspected).toBe(true);
    expect(r.interpretation).toMatch(/herding rather than of reasoning/i);
    expect(r.interpretation).toMatch(/not as independent confirmation/i);
  });

  it('fires even when most of the panel already held the eventual view', () => {
    // The case the raw flip rate structurally cannot catch: 7 of 10 already said confirm, and all
    // three dissenters capitulated. Raw flip rate 0.3; complete capitulation.
    const independent: Stance[] = [C, C, C, C, C, C, C, D, D, A];
    const final: Stance[] = [C, C, C, C, C, C, C, C, C, C];

    const r = measureAntiHerd({ independent, final });
    expect(r.flipRate).toBeCloseTo(0.3, 5);
    expect(r.capitulationRate).toBe(1);
    expect(r.herdingSuspected).toBe(true);
  });

  it('does not flag a panel where the dissenters held their ground', () => {
    const independent: Stance[] = [C, C, C, C, C, C, C, D, D, A];
    const final: Stance[] = [C, C, C, C, C, C, C, D, D, A];

    const r = measureAntiHerd({ independent, final });
    expect(r.capitulationRate).toBe(0);
    expect(r.herdingSuspected).toBe(false);
  });

  it('does not flag agreement that existed before anyone saw anything', () => {
    const independent: Stance[] = [C, C, C, C, C, C];
    const final: Stance[] = [C, C, C, C, C, C];

    const r = measureAntiHerd({ independent, final });
    expect(r.flipRate).toBe(0);
    expect(r.capitulationRate).toBe(0);
    expect(r.herdingSuspected).toBe(false);
    expect(r.independentAgreement).toBe(1);
    // It still refuses to call it independent evidence.
    expect(r.interpretation).toMatch(/not independent evidence/i);
  });

  it('does not flag a panel that stayed split', () => {
    const independent: Stance[] = [C, D, A, C, D, A];
    const final: Stance[] = [C, D, A, D, C, A];

    const r = measureAntiHerd({ independent, final });
    expect(r.herdingSuspected).toBe(false);
    expect(r.entropy).toBeGreaterThan(0.6);
    expect(r.interpretation).toMatch(/disagreement is itself the finding/i);
  });

  it('refuses to read anything into a panel of two', () => {
    const r = measureAntiHerd({ independent: [C, C], final: [C, C] });
    expect(r.herdingSuspected).toBe(false);
    expect(r.interpretation).toMatch(/too small a panel/i);
  });

  it('handles an empty panel without dividing by zero', () => {
    const r = measureAntiHerd({ independent: [], final: [] });
    expect(r.panelSize).toBe(0);
    expect(r.flipRate).toBe(0);
    expect(r.interpretation).toMatch(/nothing to measure/i);
  });

  it('measures only as many personas as both rounds have', () => {
    // Someone dropped out of the revision round; the arithmetic must not read past the shorter list.
    const r = measureAntiHerd({ independent: [C, D, A, C], final: [C, D, A] });
    expect(r.panelSize).toBe(3);
  });
});

describe('required challengers', () => {
  it('is at least half the panel, and never zero', () => {
    expect(requiredChallengers(12)).toBe(6);
    expect(requiredChallengers(9)).toBe(5);
    expect(requiredChallengers(1)).toBe(1);
    expect(requiredChallengers(0)).toBe(1);
  });
});
