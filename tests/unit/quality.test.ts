import { describe, it, expect } from 'vitest';
import { scoreQuality, QUALITY_CAVEAT } from '@/ingest/quality';

function input(overrides: Partial<Parameters<typeof scoreQuality>[0]> = {}) {
  return {
    fields: [
      { missingPct: 2, type: 'NUMERIC', typeConfidence: 0.95 },
      { missingPct: 1, type: 'CATEGORICAL', typeConfidence: 0.8 },
    ],
    rowCount: 1200,
    collectionEnd: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    hasGovernance: true,
    documentedFieldShare: 1,
    blockingFindings: 0,
    warningFindings: 0,
    ...overrides,
  };
}

describe('quality scoring', () => {
  it('always returns all five components with their weights', () => {
    const { components } = scoreQuality(input());
    expect(components.map((c) => c.key).sort()).toEqual([
      'completeness',
      'documentation',
      'recency',
      'sample_adequacy',
      'structural_integrity',
    ]);
    // Weights sum to 1, so the total is a weighted mean rather than an arbitrary blend.
    expect(components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 5);
    for (const c of components) expect(c.explanation.length).toBeGreaterThan(10);
  });

  it('scores a clean, recent, documented dataset highly', () => {
    expect(scoreQuality(input()).total).toBeGreaterThan(85);
  });

  it('penalises missingness', () => {
    const clean = scoreQuality(input()).total;
    const holey = scoreQuality(
      input({ fields: [{ missingPct: 45, type: 'NUMERIC', typeConfidence: 0.9 }] }),
    ).total;
    expect(holey).toBeLessThan(clean);
  });

  it('says what a small sample does and does not support', () => {
    const small = scoreQuality(input({ rowCount: 80 }));
    const c = small.components.find((x) => x.key === 'sample_adequacy');
    expect(c?.explanation).toMatch(/descriptive only/i);

    const large = scoreQuality(input({ rowCount: 5000 }));
    expect(large.components.find((x) => x.key === 'sample_adequacy')?.explanation).toMatch(
      /subgroup comparison/i,
    );
  });

  it('penalises stale data', () => {
    const fresh = scoreQuality(input()).total;
    const stale = scoreQuality(
      input({ collectionEnd: new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000) }),
    ).total;
    expect(stale).toBeLessThan(fresh);
  });

  it('says plainly when recency cannot be assessed rather than assuming the best', () => {
    const c = scoreQuality(input({ collectionEnd: null })).components.find(
      (x) => x.key === 'recency',
    );
    expect(c?.explanation).toMatch(/cannot be assessed/i);
    expect(c?.score).toBeLessThan(60);
  });

  it('drops structural integrity hard for a blocking finding', () => {
    const c = scoreQuality(input({ blockingFindings: 2 })).components.find(
      (x) => x.key === 'structural_integrity',
    );
    expect(c?.score).toBeLessThanOrEqual(20);
  });

  it('never leaves the 0–100 range', () => {
    const worst = scoreQuality(
      input({
        fields: [{ missingPct: 100, type: 'UNKNOWN', typeConfidence: 0 }],
        rowCount: 1,
        collectionEnd: new Date('1990-01-01'),
        hasGovernance: false,
        documentedFieldShare: 0,
        blockingFindings: 10,
        warningFindings: 10,
      }),
    );
    expect(worst.total).toBeGreaterThanOrEqual(0);
    for (const c of worst.components) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
    }
  });

  it('carries the caveat that the score is about the file, not the question', () => {
    expect(QUALITY_CAVEAT).toMatch(/not whether it answers your question/i);
  });
});
