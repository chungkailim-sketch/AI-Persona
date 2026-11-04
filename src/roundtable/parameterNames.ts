/**
 * Naming and classifying persona parameters (segment groups). Pure, so the cast builder and the
 * tests can use it without a database.
 */
export type ParameterKind = 'income' | 'age' | 'occupation' | 'spending' | 'region' | 'household' | 'gender' | 'education' | 'other';

export interface ParameterOption {
  /** The segment group as the data names it, without a trailing wave ("…_March 2024"). */
  name: string;
  kind: ParameterKind;
  /** Ordered breaks (income, age, spending) become three tiers; others one persona per segment. */
  ordered: boolean;
  recommended: boolean;
  /** How many ready datasets publish it. */
  datasets: number;
}

const KINDS: [ParameterKind, RegExp][] = [
  ['income', /income|salary|earn|affluen|wealth|class/i],
  ['spending', /spend|budget|buy|purchas|shopping|price|consum|preference|channel|brand/i],
  ['age', /\bage\b|age group|generation|gen [xyz]|millennial|boomer/i],
  ['occupation', /occupation|employ|working|job|profession|work status|sector/i],
  ['region', /region|city|tier|urban|rural|province|state|area|location/i],
  ['household', /household|child|kids|family|marital|parent|living/i],
  ['gender', /gender|\bsex\b/i],
  ['education', /educat|degree|school/i],
];
const ORDER: ParameterKind[] = ['income', 'age', 'occupation', 'spending', 'region', 'household', 'education', 'gender', 'other'];
const RECOMMENDED = new Set<ParameterKind>(['income', 'age', 'occupation', 'spending']);
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';

/** "Monthly household income_March 2024" → "Monthly household income". */
export function baseGroupName(group: string): string {
  return group
    .replace(new RegExp(`[\\s_\\-–(]*(?:${MONTHS})?\\s*\\d{4}\\)?\\s*$`, 'i'), '')
    .replace(/[\s_]+$/, '')
    .trim();
}

export function kindOf(name: string): ParameterKind {
  return KINDS.find(([, re]) => re.test(name))?.[0] ?? 'other';
}

export function proposeFromGroups(groups: { name: string; datasets: number }[]): ParameterOption[] {
  const merged = new Map<string, ParameterOption>();
  for (const g of groups) {
    const name = baseGroupName(g.name);
    if (!name || /^all$/i.test(name)) continue;
    const key = name.toLowerCase();
    const kind = kindOf(name);
    const prev = merged.get(key);
    merged.set(key, {
      name: prev?.name ?? name,
      kind,
      ordered: kind === 'income' || kind === 'age' || (kind === 'spending' && /level|amount|budget|spend/i.test(name)),
      recommended: false,
      datasets: (prev?.datasets ?? 0) + g.datasets,
    });
  }
  const list = [...merged.values()].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.datasets - a.datasets || a.name.localeCompare(b.name));
  // Recommend the best-covered group of each useful kind.
  const seen = new Set<ParameterKind>();
  for (const p of list) {
    if (RECOMMENDED.has(p.kind) && !seen.has(p.kind)) {
      p.recommended = true;
      seen.add(p.kind);
    }
  }
  return list;
}

