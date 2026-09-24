/**
 * Personas from a population sample (pure).
 *
 * The ordinary cohort generator can only describe a Mintel-style databook at whole-sample level,
 * because a long table's "fields" are its columns (statement, response, share), not its segments.
 * A population sample has already done the work of finding mutually exclusive segments and their
 * published answer distributions, so a persona built from one of its cells can carry
 * segment-level OBSERVED answers with their base — the difference between "the sample mostly
 * agrees" and "18-24s: 19% strongly agree, 29% somewhat agree (base 180)".
 *
 * Weighting follows the sample: a persona's weight is its cell's share of the population, split
 * evenly between repeats of the same cell, so repeats never multiply a segment's influence.
 */
import type { GeneratedAttribute, GeneratedPersona } from '@/server/personas';
import { deriveSeed, seededRandom } from '@/model/provider';
import type { PopulationResult } from './build';

const SMALL_BASE = 30;

export interface PopulationCohortOptions {
  personaCount: number;
  seed: number;
  datasetName: string;
  primaryGroup: string;
  secondaryGroup: string | null;
  size: number;
}

export function formatDistribution(dist: readonly { response: string; pct: number }[]): string {
  return dist.map((d) => `${d.response} ${Math.round(d.pct * 10) / 10}%`).join(' · ');
}

export function cohortFromPopulation(
  pop: Pick<PopulationResult, 'wave' | 'quotas' | 'bases' | 'profiles' | 'statements' | 'removedCells' | 'members'>,
  opts: PopulationCohortOptions,
): { personas: GeneratedPersona[]; note: string; coveredShare: number } {
  const cells = pop.quotas.filter((q) => q.members > 0).sort((a, b) => b.members - a.members || a.cell.localeCompare(b.cell));
  if (cells.length === 0) throw new Error('The population sample has no populated cells.');

  const chosen = cells.slice(0, Math.min(opts.personaCount, cells.length));
  const slots: { cell: (typeof cells)[number]; repeat: number }[] = chosen.map((cell) => ({ cell, repeat: 0 }));
  for (let i = chosen.length; i < opts.personaCount; i += 1) {
    const cell = chosen[(i - chosen.length) % chosen.length]!;
    slots.push({ cell, repeat: slots.filter((s) => s.cell.cell === cell.cell).length });
  }
  const repeatsOf = (cell: string) => slots.filter((s) => s.cell.cell === cell).length;
  const total = cells.reduce((s, c) => s + c.members, 0) || 1;
  const coveredShare = chosen.reduce((s, c) => s + c.members, 0) / total;

  const personas: GeneratedPersona[] = slots.map(({ cell, repeat }) => {
    const [primary, secondary] = cell.cell.split(' × ') as [string, string | undefined];
    const base = pop.bases.primary[primary] ?? 0;
    const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = base < SMALL_BASE ? 'LOW' : base >= 150 ? 'HIGH' : 'MEDIUM';
    const share = cell.members / total;
    const weight = Math.round((share / repeatsOf(cell.cell)) * 10000) / 10000;
    const rng = seededRandom(deriveSeed(opts.seed, cell.cell, String(repeat)));

    const attributes: GeneratedAttribute[] = [
      { group: 'segment', key: opts.primaryGroup, label: opts.primaryGroup, value: primary, origin: 'OBSERVED', confidence, baseSize: base, locked: true },
    ];
    if (secondary && opts.secondaryGroup) {
      attributes.push({
        group: 'segment',
        key: opts.secondaryGroup,
        label: opts.secondaryGroup,
        value: `${secondary} (combination assumed from the two published splits; not a measured cross-tab)`,
        origin: 'DERIVED',
        confidence: 'LOW',
        baseSize: pop.bases.secondary[secondary] ?? null,
        locked: true,
      });
    }
    for (const st of pop.statements) {
      const dist = pop.profiles[primary]?.[st];
      if (!dist || dist.length === 0) continue;
      attributes.push({
        group: 'attitudes',
        key: st,
        label: st,
        value: `${formatDistribution(dist)} (${pop.wave}, ${primary})`,
        origin: 'OBSERVED',
        confidence,
        baseSize: base,
        locked: true,
      });
    }
    attributes.push({
      group: 'motivations',
      key: 'variation',
      label: 'Simulated variation',
      value: `disposition ${(rng() * 2 - 1).toFixed(2)} (−1 sceptical to +1 receptive)`,
      origin: 'SIMULATED',
      confidence: 'LOW',
      baseSize: null,
      locked: false,
    });

    const notes: string[] = [];
    if (base < SMALL_BASE) notes.push(`The ${primary} segment has a base of ${base}; treat anything this persona says as illustrative only.`);
    if (secondary) notes.push(`Answers are the ${primary} segment's; the ${opts.secondaryGroup} split is an assumption (the databook does not cross the two).`);
    if (repeat > 0) notes.push(`Repeat ${repeat + 1} of this cell. Observed attributes are identical to the other repeats; only the simulated variation differs, and the cell's weight is shared between them.`);

    return {
      name: `${cell.cell}${repeat > 0 ? ` (${repeat + 1})` : ''}`,
      segment: cell.cell,
      weight,
      baseSize: base,
      confidence,
      coverageNote: notes.length ? notes.join(' ') : null,
      summary:
        `Describes ${cell.cell} in ${opts.datasetName}, ${pop.wave}: ${Math.round(share * 1000) / 10}% of a ` +
        `${opts.size.toLocaleString()}-member population sampled from published segment shares. ` +
        `Answer distributions are the ${primary} segment's, base ${base}.`,
      attributes,
    };
  });

  const notes = [
    `Built from a population sample of ${opts.size.toLocaleString()} (${pop.wave}). Weights are cell shares of the survey sample, not the census.`,
  ];
  if (chosen.length < cells.length) {
    notes.push(`${chosen.length} of ${cells.length} cells have a persona; together they cover ${Math.round(coveredShare * 1000) / 10}% of the population. The rest are not represented in this cohort.`);
  }
  if (opts.personaCount > chosen.length) notes.push(`${opts.personaCount - chosen.length} repeat persona(s) share their cell's weight.`);
  if (pop.removedCells.length) notes.push(`Impossible cells removed before sampling: ${pop.removedCells.join('; ')}.`);
  return { personas, note: notes.join(' '), coveredShare };
}
