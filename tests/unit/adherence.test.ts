import { describe, it, expect } from 'vitest';
import { agreeShare, chooseContrast, scoreContrast } from '../../src/run/adherence';
import { cohortFromPopulation, formatDistribution } from '../../src/population/cohort';

const dist = (agree: number) => formatDistribution([
  { response: 'Strongly agree', pct: agree / 2 },
  { response: 'Somewhat agree', pct: agree / 2 },
  { response: 'Neither agree nor disagree', pct: 10 },
  { response: 'Somewhat disagree', pct: 90 - agree },
]);

describe('agreeShare', () => {
  it('sums agree responses and ignores disagree and neither', () => {
    expect(agreeShare('Strongly agree 20% · Somewhat agree 30% · Neither agree nor disagree 10% · Somewhat disagree 40% (March 2026, 18-24)')).toBe(50);
    expect(agreeShare('mean 3.2 of 5')).toBeNull();
  });
});

describe('contrast plan and scoring', () => {
  const personas = [['18-24', 30], ['25-34', 40], ['35-54', 65], ['55+', 75]].map(([seg, a]) => ({
    key: seg as string, segment: seg as string,
    attributes: [{ label: 'Heritage matters', value: dist(a as number), origin: 'OBSERVED' }, { label: 'Flat', value: dist(60), origin: 'OBSERVED' }],
  }));
  it('picks the statement that splits segment majorities', () => {
    const plan = chooseContrast(personas)!;
    expect(plan.statement).toBe('Heritage matters');
    expect(plan.withTrait.map((p) => p.key)).toEqual(['55+', '35-54']);
    expect(plan.withoutTrait.map((p) => p.key)).toEqual(['18-24', '25-34']);
  });
  it('returns null when no statement splits majorities', () => {
    expect(chooseContrast(personas.map((p) => ({ ...p, attributes: [p.attributes[1]!] })))).toBeNull();
  });
  it('fails an agreeable panel and passes an adherent one', () => {
    const plan = chooseContrast(personas)!;
    const agreeable = scoreContrast(plan, { '55+': 'agree', '35-54': 'agree', '18-24': 'agree', '25-34': 'agree' });
    expect(agreeable.status).toBe('fail');
    expect(agreeable.reason).toMatch(/agreeable drift/);
    expect(scoreContrast(plan, { '55+': 'agree', '35-54': 'agree', '18-24': 'disagree', '25-34': 'neither' }).status).toBe('pass');
  });
});

describe('cohortFromPopulation', () => {
  const pop = {
    wave: 'March 2026',
    quotas: [
      { cell: '18-24 × Working', weight: 0.2, members: 200 },
      { cell: '25-34 × Working', weight: 0.5, members: 500 },
      { cell: '55+ × Retired', weight: 0.3, members: 300 },
    ],
    bases: { primary: { '18-24': 20, '25-34': 400, '55+': 300 }, secondary: { Working: 600, Retired: 300 } },
    profiles: {
      '18-24': { 'Heritage matters': [{ response: 'Agree', pct: 30 }, { response: 'Disagree', pct: 70 }] },
      '25-34': { 'Heritage matters': [{ response: 'Agree', pct: 45 }, { response: 'Disagree', pct: 55 }] },
      '55+': { 'Heritage matters': [{ response: 'Agree', pct: 70 }, { response: 'Disagree', pct: 30 }] },
    },
    statements: ['Heritage matters'],
    removedCells: ['18-24 × Retired'],
    members: 1000,
  };
  const opts = { seed: 1, datasetName: 'US', primaryGroup: 'Age groups', secondaryGroup: 'Employment', size: 1000 };

  it('gives each cell a persona with segment-level observed answers, largest first', () => {
    const r = cohortFromPopulation(pop, { ...opts, personaCount: 3 });
    expect(r.personas.map((p) => p.name)).toEqual(['25-34 × Working', '55+ × Retired', '18-24 × Working']);
    const heritage = r.personas[0]!.attributes.find((a) => a.label === 'Heritage matters')!;
    expect(heritage.origin).toBe('OBSERVED');
    expect(heritage.value).toMatch(/Agree 45% · Disagree 55%/);
    expect(heritage.baseSize).toBe(400);
    expect(r.personas[0]!.attributes.find((a) => a.label === 'Employment')!.origin).toBe('DERIVED');
    expect(r.personas[2]!.confidence).toBe('LOW');
    expect(r.coveredShare).toBe(1);
  });
  it('covers the largest cells when fewer personas are asked for, and says so', () => {
    const r = cohortFromPopulation(pop, { ...opts, personaCount: 2 });
    expect(r.coveredShare).toBeCloseTo(0.8);
    expect(r.note).toMatch(/2 of 3 cells/);
  });
  it('repeats share their cell weight so a segment never counts twice', () => {
    const r = cohortFromPopulation(pop, { ...opts, personaCount: 4 });
    const w = r.personas.filter((p) => p.segment === '25-34 × Working').map((p) => p.weight);
    expect(w).toEqual([0.25, 0.25]);
    expect(r.personas.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1);
  });
});
