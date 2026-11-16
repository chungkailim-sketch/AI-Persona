import { describe, expect, it } from 'vitest';
import { DebateClosing, DebateFraming, DebateOpening, DebateVerdict, ModeratorHandoff } from '@/debate/schemas';

describe('debate schemas: lenient in form, strict in substance', () => {
  it('accepts a moderator who hands the floor to more agents than a round allows, and trims long text', () => {
    const r = ModeratorHandoff.safeParse({
      focus: '价格叙事是否削弱高端可信度？'.repeat(80),
      handoffs: Array.from({ length: 12 }, (_, i) => ({ agentKey: `P${i + 1}`, respondTo: 'P1', prompt: '请回应这一论点。'.repeat(120) })),
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.handoffs).toHaveLength(12);
    expect(r.data.focus.length).toBeLessThanOrEqual(600);
    expect(r.data.handoffs[0]!.prompt.length).toBeLessThanOrEqual(600);
  });

  it('accepts a framing with too many, or missing, lists', () => {
    const r = DebateFraming.safeParse({ motion: '本品牌应以价格还是技术为主信息？', subQuestions: Array.from({ length: 9 }, (_, i) => `问题 ${i}`), decisionCriteria: null });
    expect(r.success).toBe(true);
    if (r.success) expect([r.data.subQuestions.length, r.data.decisionCriteria.length, r.data.groundRules.length]).toEqual([6, 0, 0]);
  });

  it('normalises stance, confidence and flags written loosely', () => {
    const o = DebateOpening.parse({ stance: '支持', confidence: '80%', argument: '理由。', keyPoints: '一点' });
    expect([o.stance, o.confidence, o.keyPoints]).toEqual(['support', 0.8, ['一点']]);
    const c = DebateClosing.parse({ stance: 'Oppose', confidence: 65, changed: 'yes', reason: 'r', finalArgument: 'f' });
    expect([c.stance, c.confidence, c.changed]).toEqual(['oppose', 0.65, true]);
    const v = DebateVerdict.parse({ answer: 'Not supported', conclusion: 'c', basis: 'Direct' });
    expect([v.answer, v.basis, v.dissent]).toEqual(['not_supported', 'direct', []]);
    // The judge always lands on the closest conclusion: an older "insufficient" answer reads as mixed, inferred.
    const old = DebateVerdict.parse({ answer: 'insufficient_evidence', conclusion: 'c', confidence: 'low' });
    expect([old.answer, old.basis]).toEqual(['mixed', 'inferred']);
  });

  it('still refuses an answer whose core content is missing', () => {
    expect(ModeratorHandoff.safeParse({ focus: '', handoffs: [] }).success).toBe(false);
    expect(DebateOpening.safeParse({ stance: 'support', confidence: 0.5 }).success).toBe(false);
    expect(DebateFraming.safeParse({}).success).toBe(false);
  });
});
