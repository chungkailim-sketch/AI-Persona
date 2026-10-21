import { describe, it, expect } from 'vitest';
import { CommsReport, InterviewAnswer, PanelAnswer } from '../../src/debate/insightSchemas';

describe('insight answer shapes are lenient about form, strict about substance', () => {
  it('accepts a long, slightly off-shape report by trimming and normalising it', () => {
    const r = CommsReport.parse({
      title: 'Entering Indonesia',
      executiveSummary: 'x'.repeat(9000),
      situation: ['Point one', 'Point two'],
      objectives: Array.from({ length: 11 }, (_, i) => `Objective ${i}`),
      audienceInsights: { segment: 'Gen Z', insight: 'Trusts creators', implication: 'Use creators', evidenceIds: ['e1', 'E2'] },
      positioning: { promise: 'Quality', proof: 'Warranty' },
      keyMessages: [{ message: 'Built to last', audience: 'All', proofPoints: 'Two-year warranty' }],
      risks: [{ risk: 'Backlash', likelihood: 'Medium', mitigation: 'Local partners' }, { risk: 'Price war', likelihood: 'very high', mitigation: 'Hold' }],
    });
    expect(r.executiveSummary.length).toBe(5000);
    expect(r.situation).toBe('Point one; Point two');
    expect(r.objectives).toHaveLength(8);
    expect(r.audienceInsights[0]!.segment).toBe('Gen Z');
    expect(r.keyMessages[0]!.proofPoints).toEqual(['Two-year warranty']);
    expect(r.risks.map((x) => x.likelihood)).toEqual(['medium', 'medium']);
    expect(r.channels).toEqual([]);
  });

  it('still rejects a report with no executive summary', () => {
    expect(() => CommsReport.parse({ title: 'Empty' })).toThrow();
  });

  it('normalises panel ratings and confidence', () => {
    const a = PanelAnswer.parse({
      answer: 'Phones, maybe cars',
      categories: [{ category: 'Phones', likelihood: 'Very likely', reason: 'Value' }, { category: 'Cars', likelihood: 'would not', reason: 'Safety' }],
      confidence: 70,
    });
    expect(a.categories.map((c) => c.likelihood)).toEqual(['very_likely', 'would_not']);
    expect(a.confidence).toBe(0.7);
    expect(InterviewAnswer.parse({ answer: 'Yes', confidence: '0.4', outsideEvidence: 'true' }).outsideEvidence).toBe(true);
  });
});
