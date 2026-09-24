import { describe, it, expect } from 'vitest';
import {
  checkClaim,
  figuresIn,
  collectEvidenceFigures,
  CLAIM_CHECK_NOTICE,
} from '@/report/claimCheck';

const base = {
  evidenceFigures: [120, 40, 33.3, 3.2, 2.8, 5, 1],
  evidenceGrade: 'L3_PERSONA_SIMULATION',
  panelSize: 12,
  isMock: false,
};

describe('figures in a claim', () => {
  it('finds percentages', () => {
    expect(figuresIn('68% of the panel agreed', 12)).toContain(68);
  });

  it('ignores a year', () => {
    expect(figuresIn('collected in 2026', 12)).not.toContain(2026);
  });

  it('ignores a tally the claim is entitled to state', () => {
    // "9 of 12" is the panel arithmetic, not a figure that needs a source.
    expect(figuresIn('9 of 12 personas confirmed', 12)).toEqual([]);
  });

  it('finds a figure above the panel size, which must have come from somewhere', () => {
    expect(figuresIn('an average spend of 340', 12)).toContain(340);
  });
});

describe('unsupported figures', () => {
  it('blocks a percentage that is nowhere in the evidence', () => {
    const r = checkClaim({ ...base, claim: 'Purchase intent rose 68% year on year.' });
    const issue = r.issues.find((i) => i.kind === 'unsupported_figure');
    expect(issue?.severity).toBe('blocking');
    expect(issue?.message).toMatch(/does not appear anywhere in this run's evidence/);
    expect(r.ok).toBe(false);
  });

  it('accepts a figure that is in the evidence', () => {
    const r = checkClaim({ ...base, claim: 'The sample contained 120 responses.' });
    expect(r.issues.filter((i) => i.kind === 'unsupported_figure')).toEqual([]);
  });

  it('tolerates rounding, because prose rounds', () => {
    // 3.2 is in the evidence; "3.2" written as "3" should not be treated as invented.
    const r = checkClaim({ ...base, claim: 'The mean was 3.2 on a five-point scale.' });
    expect(r.issues.filter((i) => i.kind === 'unsupported_figure')).toEqual([]);
  });
});

describe('overstated certainty', () => {
  it('blocks language that says the claim is established', () => {
    for (const word of ['proves', 'confirms', 'demonstrates', 'validates', 'definitively']) {
      const r = checkClaim({ ...base, claim: `This ${word} that the premium tier will win.` });
      expect(r.issues.some((i) => i.kind === 'overstated_certainty'), word).toBe(true);
      expect(r.ok, word).toBe(false);
    }
  });

  it('names the grade in the explanation, rather than just refusing', () => {
    const r = checkClaim({ ...base, claim: 'The run proves the hypothesis.' });
    const issue = r.issues.find((i) => i.kind === 'overstated_certainty');
    expect(issue?.message).toMatch(/l3 persona simulation/i);
    expect(issue?.suggestion).toMatch(/worth testing with real people/);
  });

  it('does not fire on a word that merely contains a trigger', () => {
    // "approves" contains "proves"; the word-boundary check must stop it.
    const r = checkClaim({ ...base, claim: 'The reviewer approves of this approach.' });
    expect(r.issues.some((i) => i.kind === 'overstated_certainty')).toBe(false);
  });

  it('accepts hedged language', () => {
    const r = checkClaim({
      ...base,
      claim: 'The simulated panel largely supported the claim; this is worth testing with real people.',
    });
    expect(r.ok).toBe(true);
  });
});

describe('generalisation beyond the sample', () => {
  it('blocks a population noun', () => {
    for (const word of ['consumers', 'the market', 'people', 'shoppers']) {
      const r = checkClaim({ ...base, claim: `This shows ${word} prefer the premium tier.` });
      expect(r.issues.some((i) => i.kind === 'generalisation_beyond_sample'), word).toBe(true);
    }
  });

  it('explains what the evidence actually describes', () => {
    const r = checkClaim({ ...base, claim: 'Consumers prefer the premium tier.' });
    const issue = r.issues.find((i) => i.kind === 'generalisation_beyond_sample');
    expect(issue?.message).toMatch(/12 simulated personas/);
    expect(issue?.suggestion).toMatch(/the simulated panel/);
  });

  it('accepts a claim scoped to what was observed', () => {
    const r = checkClaim({
      ...base,
      claim: 'The simulated panel leaned towards the premium tier in this dataset.',
    });
    expect(r.ok).toBe(true);
  });
});

describe('causal language', () => {
  it('warns rather than blocks, because it is sometimes defensible', () => {
    const r = checkClaim({ ...base, claim: 'Price sensitivity drives the preference.' });
    const issue = r.issues.find((i) => i.kind === 'causal_language');
    expect(issue?.severity).toBe('warning');
    // A warning does not stop an export.
    expect(r.ok).toBe(true);
  });

  it('does not fire on "because" containing "cause"', () => {
    const r = checkClaim({
      ...base,
      claim: 'The simulated panel split, which matters here.',
    });
    expect(r.issues.some((i) => i.kind === 'causal_language')).toBe(false);
  });
});

describe('attributing a result to real people', () => {
  it('blocks it', () => {
    const r = checkClaim({ ...base, claim: 'Respondents said they would switch.' });
    const issue = r.issues.find((i) => i.kind === 'real_world_attribution');
    expect(issue?.severity).toBe('blocking');
    expect(issue?.message).toMatch(/Nobody was asked/);
  });
});

describe('a mock run', () => {
  it('cannot support any claim at all, however carefully worded', () => {
    const r = checkClaim({
      ...base,
      isMock: true,
      claim: 'The simulated panel leaned towards the premium tier.',
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('mock provider'))).toBe(true);
  });
});

describe('collecting evidence figures', () => {
  it('gathers bases, counts, shares and numeric summaries', () => {
    const figures = collectEvidenceFigures(
      [
        {
          baseSize: 100,
          topValues: [{ count: 40 }, { count: 60 }],
          numeric: { min: 1, max: 5, mean: 3.25, median: 3, sd: 1.1 },
        },
      ],
      120,
    );
    expect(figures).toContain(120);
    expect(figures).toContain(100);
    expect(figures).toContain(40);
    expect(figures).toContain(40); // 40/100 as a share
    expect(figures).toContain(3.25);
    expect(figures).toContain(1.1);
  });
});

describe('the notice', () => {
  it('says plainly what the check cannot do', () => {
    expect(CLAIM_CHECK_NOTICE).toMatch(/cannot tell you whether a claim is true/i);
    expect(CLAIM_CHECK_NOTICE).toMatch(/that judgement is yours/i);
  });
});

describe('population nouns that are not generalisations', () => {
  it('does not block the phrasing it recommends', () => {
    // "worth testing with real people" is this module's own suggested wording. A checker that
    // refuses the language it recommends teaches people to ignore it.
    const r = checkClaim({
      ...base,
      claim: 'The simulated panel largely supported the claim; this is worth testing with real people.',
    });
    expect(r.issues.filter((i) => i.kind === 'generalisation_beyond_sample')).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('allows other explicit contrasts with the simulation', () => {
    for (const phrase of [
      'validate this with actual consumers before acting',
      'the simulated consumers split evenly',
      'no real shoppers were involved',
    ]) {
      const r = checkClaim({ ...base, claim: phrase });
      expect(r.issues.some((i) => i.kind === 'generalisation_beyond_sample'), phrase).toBe(false);
    }
  });

  it('still blocks an unqualified population noun elsewhere in the same sentence', () => {
    // The first occurrence is exempt; the second is a generalisation and must still be caught.
    const r = checkClaim({
      ...base,
      claim: 'Worth testing with real people, but consumers clearly prefer the premium tier.',
    });
    expect(r.issues.some((i) => i.kind === 'generalisation_beyond_sample')).toBe(true);
  });
});
