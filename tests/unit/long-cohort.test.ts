import { describe, expect, it } from 'vitest';
import { generateLongTableCohort, traitPhrase } from '../../src/server/longCohort';

const H = ['market', 'wave', 'wave_year', 'wave_month', 'question_id', 'statement', 'response', 'segment_group', 'segment', 'sample_base', 'share'];
const r = (market: string, seg: string, statement: string, share: number, year = 2026, response = 'Agree', base = 200) =>
  [market, `March ${year}`, String(year), 'March', 'Q1', statement, response, seg === 'All' ? 'All' : /male/i.test(seg) ? 'Gender' : 'Age groups', seg, String(seg === 'All' ? 1000 : base), String(share)];

describe('personas from a survey long table', () => {
  const rows = [
    r('China', 'All', 'I would trust a product recommended by an AI assistant', 38),
    r('China', '16-24', 'I would trust a product recommended by an AI assistant', 55),
    r('China', '25-34', 'I would trust a product recommended by an AI assistant', 30),
    r('China', 'All', 'I enjoy cooking at home', 60),
    r('China', '16-24', 'I enjoy cooking at home', 50),
    r('China', '25-34', 'I enjoy cooking at home', 72),
    r('China', 'Female', 'I enjoy cooking at home', 70, 2026, 'Agree', 500),
    r('China', '16-24', 'I would trust a product recommended by an AI assistant', 10, 2025),
    r('Mexico', 'All', 'I enjoy cooking at home', 50),
    r('Mexico', '16-24', 'I enjoy cooking at home', 58),
  ];
  const out = generateLongTableCohort({ headers: H, rows }, { datasetName: 'Mintel', seed: 1 })!;

  it('makes one persona per market and published age or gender segment, never one per question', () => {
    expect(out.personas.map((p) => p.segment)).toEqual(['China · 16-24', 'China · 25-34', 'China · Female', 'Mexico · 16-24']);
    expect(out.personas.some((p) => /^Q\d/.test(p.name))).toBe(false);
  });

  it('names each persona after what distinguishes it, from the latest wave', () => {
    expect(out.personas[0]!.name).toBe('16-24, China: I would trust a product recommended by an AI assistant');
    expect(out.personas[1]!.name).toBe('25-34, China: I enjoy cooking at home');
  });

  it('describes a persona with observed shares against its market, carrying the base', () => {
    const attr = out.personas[0]!.attributes.find((a) => a.group === 'attitudes')!;
    expect(attr).toMatchObject({ origin: 'OBSERVED', baseSize: 200, value: '55% vs 38% of all adults in China (+17 pp)' });
    expect(out.personas[0]!.attributes.find((a) => a.key === 'market')!.value).toBe('China');
    expect(out.personas[0]!.attributes.filter((a) => a.origin === 'SIMULATED')).toHaveLength(1);
  });

  it('reads a non-agreement response into the trait', () => {
    expect(traitPhrase('Use AI assistants', 'Daily')).toBe('Daily — Use AI assistants');
  });
});
