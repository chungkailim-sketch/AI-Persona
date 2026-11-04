import { describe, expect, it } from 'vitest';
import { baseGroupName, kindOf, proposeFromGroups } from '../../src/roundtable/parameterNames';
import { buildCastSeeds } from '../../src/server/castBuilder';
import { activeModules } from '../../src/modules/registry';

describe('persona parameters proposed from the data', () => {
  it('drops the wave from a segment group and merges waves', () => {
    expect(baseGroupName('Monthly household income_March 2024')).toBe('Monthly household income');
    expect(baseGroupName('Age groups (2025)')).toBe('Age groups');
    const p = proposeFromGroups([
      { name: 'Monthly household income_March 2024', datasets: 3 },
      { name: 'Monthly household income_March 2025', datasets: 2 },
      { name: 'Gender', datasets: 5 },
      { name: 'Working status', datasets: 4 },
      { name: 'Age groups', datasets: 5 },
      { name: 'All', datasets: 5 },
    ]);
    expect(p.map((x) => x.name)).toEqual(['Monthly household income', 'Age groups', 'Working status', 'Gender']);
    expect(p[0]).toMatchObject({ kind: 'income', ordered: true, recommended: true, datasets: 5 });
    expect(p.find((x) => x.name === 'Working status')).toMatchObject({ kind: 'occupation', ordered: false, recommended: true });
    expect(p.find((x) => x.name === 'Gender')!.recommended).toBe(false);
  });

  it('classifies common Mintel breaks', () => {
    expect(['Region', 'Employment status', 'Children in household', 'Highest education'].map(kindOf)).toEqual(['region', 'occupation', 'household', 'education']);
  });
});

const HEAD = ['market', 'wave', 'wave_year', 'wave_month', 'statement', 'response', 'segment_group', 'segment', 'sample_base', 'share'];
const row = (group: string, seg: string, base: number, share: number) => ['Thailand', 'March 2026', '2026', 'March', 'I buy online weekly', 'Agree', group, seg, String(base), String(share)];

describe('personas on a chosen parameter', () => {
  it('gives one persona per published segment of an unordered parameter, the largest first', () => {
    const t = { headers: HEAD, rows: [row('All', 'All', 1000, 40), row('Working status_March 2026', 'Full-time', 500, 55), row('Working status_March 2026', 'Student', 120, 70), row('Working status_March 2026', 'Retired', 200, 20), row('Working status_March 2026', 'Prefer not to say', 30, 40)] };
    const { seeds } = buildCastSeeds([t], ['Thailand'], ['Working status']);
    expect(seeds.map((s) => s.tierLabel)).toEqual(['Full-time', 'Retired', 'Student']);
    expect(seeds[0]).toMatchObject({ group: 'Working status', basis: 'segment', base: 500 });
  });

  it('says when a chosen parameter is not published for a market', () => {
    const t = { headers: HEAD, rows: [row('All', 'All', 1000, 40)] };
    const { seeds, notes } = buildCastSeeds([t], ['Thailand'], ['Region']);
    expect(seeds).toEqual([]);
    expect(notes[0]).toMatch(/"Region" is not published/);
  });
});

describe('modules', () => {
  it('uses the use case preset until the team chooses, and honours an empty choice', () => {
    expect(activeModules({ useCase: 'crisis', modules: [] }).has('roundtable')).toBe(false);
    expect(activeModules({ useCase: 'crisis', modules: [] }).has('debate')).toBe(true);
    expect([...activeModules({ useCase: 'market_entry', modules: ['knowledge'] })]).toEqual(['knowledge']);
    expect(activeModules({ useCase: 'market_entry', modules: ['none'] }).size).toBe(0);
  });
});
