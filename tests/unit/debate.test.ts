import { describe, expect, it } from 'vitest';
import { ageRange, compareSegments, matchSegments, mentionedRanges, relevance, selectEvidence, topicTerms, type LongTableInput } from '../../src/debate/evidence';
import { resolveHandoffs, specialistAgents } from '../../src/debate/crew';
import { leaning, pickPersonas } from '../../src/debate/engine';

const HEADERS = ['market', 'wave', 'wave_year', 'wave_month', 'question_id', 'statement', 'response', 'segment_group', 'segment', 'sample_base', 'share'];
function row(statement: string, segment: string, share: number, opts: { wave?: [number, string]; group?: string; base?: number; q?: string; response?: string } = {}) {
  const [y, m] = opts.wave ?? [2026, 'March'];
  return ['China', `${m} ${y}`, String(y), m, opts.q ?? 'Q1', statement, opts.response ?? 'Agree', opts.group ?? (segment === 'All' ? 'All' : 'Age groups'), segment, String(opts.base ?? 400), String(share)];
}
const table = (rows: string[][], questions: [string, string][] = []): LongTableInput => ({ source: 'Mintel — China', headers: HEADERS, rows, questionText: new Map(questions) });

describe('finding the evidence a motion is about', () => {
  it('expands the motion with domain synonyms', () => {
    const terms = topicTerms('Can ChatGPT ads be trusted?');
    expect(terms).toEqual(expect.arrayContaining(['chatgpt', 'ai', 'advertising', 'sponsored', 'trust']));
  });

  it('matches short terms as whole words only', () => {
    expect(relevance('Ads shown by AI assistants', ['ad', 'ai'])).toBeGreaterThan(0);
    expect(relevance('Adults in the household', ['ad'])).toBe(0);
  });

  it('reads age ranges from free text and maps them to the published breaks', () => {
    expect(mentionedRanges('is 15-24 or 25 to 34 more susceptible than 55+?')).toEqual(['15-24', '25to34', '55+']);
    expect(mentionedRanges('15-24s are more susceptible than 25-34s')).toEqual(['15-24', '25-34']);
    expect(ageRange('55+')).toEqual([55, 120]);
    const m = matchSegments(['15-24', '25-34', 'Martians'], ['16-24', '25-34', '35-44']);
    expect(m.map((x) => x.matched)).toEqual(['16-24', '25-34', null]);
    expect(m[0]!.note).toMatch(/closest, "16-24"/);
    expect(m[1]!.note).toBeNull();
  });

  it('selects relevant statements from the latest wave only, and numbers every figure', () => {
    const t = table([
      row('I trust ads shown by AI assistants', 'All', 40),
      row('I trust ads shown by AI assistants', '16-24', 55),
      row('I trust ads shown by AI assistants', '25-34', 30),
      row('I trust ads shown by AI assistants', '16-24', 20, { wave: [2025, 'March'] }),
      row('I enjoy gardening', '16-24', 70, { q: 'Q2' }),
      row('I trust ads shown by AI assistants', '16-24', 400, { response: 'Sample' }),
    ]);
    const s = selectEvidence([t], { topic: 'Can AI advertising be trusted?', focusRequested: ['15-24', '25-34'] });
    expect(s.statementsSelected.map((x) => x.statement)).toEqual(['I trust ads shown by AI assistants']);
    expect(s.items.map((i) => `${i.id} ${i.segment} ${i.share}`)).toEqual(['E1 All 40', 'E2 16-24 55', 'E3 25-34 30']);
    expect(s.comparison!.segments).toEqual(['16-24', '25-34']);
    expect(s.comparison!.higherA).toBe(1);
  });

  it('says plainly when nothing in the data addresses the motion', () => {
    const s = selectEvidence([table([row('I enjoy gardening', 'All', 70)])], { topic: 'Are AI ads biased to sponsored products?', focusRequested: [] });
    expect(s.items).toHaveLength(0);
    expect(s.notes.join(' ')).toMatch(/No statement in the cleared data/);
  });

  it('corrects for many comparisons and does not call a small gap significant', () => {
    const c = compareSegments(
      [
        { market: 'X', wave: 'w', statement: 's1', response: 'Agree', segment: 'A', share: 52, base: 200 },
        { market: 'X', wave: 'w', statement: 's1', response: 'Agree', segment: 'B', share: 50, base: 200 },
        { market: 'X', wave: 'w', statement: 's2', response: 'Agree', segment: 'A', share: 20, base: 400 },
        { market: 'X', wave: 'w', statement: 's2', response: 'Agree', segment: 'B', share: 45, base: 400 },
      ],
      'A',
      'B',
    );
    expect(c.rows.map((r) => r.significant)).toEqual([false, true]);
    expect(c.rows[1]!.diffPp).toBe(-25);
    expect([c.higherA, c.higherB, c.noDifference]).toEqual([0, 1, 1]);
  });
});

describe('the crew', () => {
  it('has a manager and three specialists, each with a role, a goal and a backstory', () => {
    const s = specialistAgents();
    expect(s.map((a) => a.kind)).toEqual(['moderator', 'analyst', 'advocate', 'judge']);
    for (const a of s) expect(a.role && a.goal && a.backstory).toBeTruthy();
  });

  const personas = [
    { key: 'P1', stance: 'support', confidence: 0.9 },
    { key: 'P2', stance: 'support', confidence: 0.6 },
    { key: 'P3', stance: 'support', confidence: 0.5 },
    { key: 'P4', stance: 'oppose', confidence: 0.7 },
  ];

  it('keeps a valid set of handoffs that gives the minority the floor', () => {
    const r = resolveHandoffs({ proposed: [{ agentKey: 'P4', respondTo: 'P1', prompt: 'x' }, { agentKey: 'P2', respondTo: 'P4', prompt: 'y' }], personas, maxSpeakers: 4, round: 1, focus: 'f' });
    expect(r.replaced).toBe(false);
    expect(r.handoffs.map((h) => h.agentKey)).toEqual(['P4', 'P2']);
  });

  it('replaces handoffs that only let the majority speak, putting the minority first', () => {
    const r = resolveHandoffs({ proposed: [{ agentKey: 'P1', respondTo: 'P2', prompt: 'x' }], personas, maxSpeakers: 2, round: 1, focus: 'f' });
    expect(r.replaced).toBe(true);
    expect(r.handoffs[0]).toMatchObject({ agentKey: 'P4', respondTo: 'P1' });
    expect(r.reason).toMatch(/minority/);
  });

  it('drops handoffs to agents that do not exist, and never lets an agent answer itself', () => {
    const r = resolveHandoffs({ proposed: [{ agentKey: 'P9', respondTo: 'P1', prompt: 'x' }, { agentKey: 'P4', respondTo: 'P4', prompt: 'x' }], personas, maxSpeakers: 3, round: 2, focus: 'f' });
    expect(r.replaced).toBe(true);
    expect(r.handoffs.every((h) => h.agentKey !== h.respondTo)).toBe(true);
  });

  it('knows which way a panel leans, and that a tie leans nowhere', () => {
    expect(leaning(new Map([['a', { stance: 'support' as const }], ['b', { stance: 'support' as const }], ['c', { stance: 'oppose' as const }]]))).toBe('support');
    expect(leaning(new Map([['a', { stance: 'support' as const }], ['b', { stance: 'oppose' as const }]]))).toBeNull();
  });

  it('seats approved personas only, the focus segments first', () => {
    const v = (approval: string, segment: string, weight: number) => [{ approval, segment, weight, summary: null, baseSize: 100, coverageNote: null, enabled: true, attributes: [] }];
    const agents = pickPersonas(
      [
        { id: 'a', name: '35-44', versions: v('APPROVED', '35-44', 0.5) },
        { id: 'b', name: '16-24', versions: v('APPROVED', '16-24', 0.1) },
        { id: 'c', name: '25-34', versions: v('DRAFT', '25-34', 0.4) },
      ],
      ['16-24'],
    );
    expect(agents.map((a) => `${a.key}:${a.name}`)).toEqual(['P1:16-24', 'P2:35-44']);
  });
});
