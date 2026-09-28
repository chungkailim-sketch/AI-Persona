/**
 * Personas from a survey long table (market × wave × statement × response × segment, with a share
 * and a base) — the shape Mintel databooks are structured into.
 *
 * The generic builder splits a file on one categorical column and describes every persona with
 * whole-sample figures. On a long table that splits on the question id and produces personas called
 * "Q1", "Q2" that describe nothing. Here a persona is a real published segment in a real market —
 * "25-34 in China" — and its attributes are the statements on which that segment differs most from
 * the market as a whole, each with both shares and the segment's base. Its name is built from those
 * attributes, so it says what is distinctive about the segment rather than which column it came from.
 *
 * Nothing is invented: every attribute is a published share, and the one simulated attribute is
 * labelled as such, exactly as in the generic builder.
 */
import { deriveSeed, seededRandom } from '@/model/provider';
import { BASE_RESPONSE } from '@/forecast/series';
import type { GeneratedAttribute, GeneratedPersona } from './personas';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SMALL_BASE = 30;
/** The demographic breaks that make a persona. Others (income, region…) are too thin per cell. */
const PERSONA_GROUPS = /^(age groups?|age|gender)$/i;
const MAX_PERSONAS = 60;
const TRAITS = 4;
const AGREE = /^(agree|yes|strongly agree|somewhat agree|any agree|net agree|very likely|likely)$/i;

interface Row {
  market: string; t: number; wave: string; statement: string; response: string;
  group: string; segment: string; base: number | null; share: number;
}

function rowsOf(headers: string[], rows: string[][]): Row[] {
  const c = (n: string) => headers.findIndex((h) => h.trim().toLowerCase() === n);
  const ix = { market: c('market'), year: c('wave_year'), month: c('wave_month'), wave: c('wave'), statement: c('statement'), response: c('response'), group: c('segment_group'), segment: c('segment'), base: c('sample_base'), share: c('share') };
  const out: Row[] = [];
  for (const r of rows) {
    const share = Number(r[ix.share]);
    const response = (r[ix.response] ?? '').trim();
    if (!Number.isFinite(share) || share < 0 || share > 100 || BASE_RESPONSE.test(response)) continue;
    const year = Number(r[ix.year]);
    const mi = MONTHS.indexOf((r[ix.month] ?? '').trim().toLowerCase());
    const base = ix.base >= 0 ? Number(r[ix.base]) : NaN;
    out.push({
      market: ix.market >= 0 ? (r[ix.market] ?? '').trim() || 'All markets' : 'All markets',
      t: Number.isFinite(year) && mi >= 0 ? year * 12 + mi : 0,
      wave: ix.wave >= 0 ? (r[ix.wave] ?? '').trim() : '',
      statement: (r[ix.statement] ?? '').trim(),
      response,
      group: (r[ix.group] ?? '').trim(),
      segment: (r[ix.segment] ?? '').trim(),
      base: Number.isFinite(base) && base > 0 ? base : null,
      share,
    });
  }
  return out;
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

/** The trait a statement/response pair describes, in a form that reads as part of a name. */
export function traitPhrase(statement: string, response: string): string {
  const s = statement.replace(/^["“]|["”]$/g, '').replace(/\.$/, '');
  if (AGREE.test(response)) return s;
  return `${response} — ${s}`;
}

export function generateLongTableCohort(
  table: { headers: string[]; rows: string[][] },
  opts: { datasetName: string; seed: number; maxPersonas?: number },
): { personas: GeneratedPersona[]; note: string } | null {
  const all = rowsOf(table.headers, table.rows);
  if (all.length === 0) return null;

  const latest = new Map<string, number>();
  for (const r of all) latest.set(r.market, Math.max(latest.get(r.market) ?? 0, r.t));
  const current = all.filter((r) => r.t === latest.get(r.market));

  // The whole-market share for each statement/response, to measure each segment against.
  const overall = new Map<string, number>();
  for (const r of current) if (r.group.toLowerCase() === 'all') overall.set(`${r.market}|${r.statement}|${r.response}`, r.share);

  const cells = new Map<string, { market: string; group: string; segment: string; wave: string; base: number | null; rows: Row[] }>();
  for (const r of current) {
    if (!PERSONA_GROUPS.test(r.group)) continue;
    const key = `${r.market}|${r.group}|${r.segment}`;
    const cell = cells.get(key) ?? { market: r.market, group: r.group, segment: r.segment, wave: r.wave, base: null, rows: [] };
    cell.base = Math.max(cell.base ?? 0, r.base ?? 0) || cell.base;
    cell.rows.push(r);
    cells.set(key, cell);
  }
  if (cells.size === 0) return null;

  const groupTotals = new Map<string, number>();
  for (const c of cells.values()) groupTotals.set(`${c.market}|${c.group}`, (groupTotals.get(`${c.market}|${c.group}`) ?? 0) + (c.base ?? 0));

  const ordered = [...cells.values()].sort(
    (a, b) => a.market.localeCompare(b.market) || a.group.localeCompare(b.group) || a.segment.localeCompare(b.segment, undefined, { numeric: true }),
  );
  const limit = opts.maxPersonas ?? MAX_PERSONAS;
  const personas: GeneratedPersona[] = [];

  for (const cell of ordered.slice(0, limit)) {
    const base = cell.base ?? 0;
    const confidence: GeneratedPersona['confidence'] = base < SMALL_BASE ? 'LOW' : base >= 150 ? 'HIGH' : 'MEDIUM';
    const diffs = cell.rows
      .map((r) => {
        const o = overall.get(`${r.market}|${r.statement}|${r.response}`);
        return o === undefined ? null : { r, o, d: Math.round((r.share - o) * 10) / 10 };
      })
      .filter((x): x is { r: Row; o: number; d: number } => x !== null);
    const above = diffs.filter((x) => x.d > 0 && x.r.share >= 15).sort((a, b) => b.d - a.d).slice(0, TRAITS);
    const below = diffs.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 2);

    const attributes: GeneratedAttribute[] = [
      { group: 'segment', key: 'market', label: 'Market', value: cell.market, origin: 'OBSERVED', confidence, baseSize: base || null, locked: true },
      { group: 'segment', key: cell.group, label: cell.group, value: cell.segment, origin: 'OBSERVED', confidence, baseSize: base || null, locked: true },
      ...above.map((x) => ({
        group: 'attitudes',
        key: `${x.r.statement}|${x.r.response}`,
        label: clip(`"${x.r.statement}" → ${x.r.response}`, 200),
        value: `${x.r.share}% vs ${x.o}% of all adults in ${cell.market} (+${x.d} pp)`,
        origin: 'OBSERVED' as const,
        confidence,
        baseSize: base || null,
        locked: true,
      })),
      ...below.map((x) => ({
        group: 'barriers',
        key: `${x.r.statement}|${x.r.response}`,
        label: clip(`"${x.r.statement}" → ${x.r.response}`, 200),
        value: `${x.r.share}% vs ${x.o}% of all adults in ${cell.market} (${x.d} pp)`,
        origin: 'OBSERVED' as const,
        confidence,
        baseSize: base || null,
        locked: true,
      })),
    ];
    const rng = seededRandom(deriveSeed(opts.seed, cell.market, cell.segment));
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

    // Name after an agreement where there is one: "Neutral — …" describes a segment poorly.
    const top = above.find((x) => AGREE.test(x.r.response)) ?? above.find((x) => !/neutral|don.?t know|not sure|none/i.test(x.r.response)) ?? above[0];
    const name = top
      ? `${cell.segment}, ${cell.market}: ${clip(traitPhrase(top.r.statement, top.r.response), 70)}`
      : `${cell.segment}, ${cell.market}`;
    const share = base / (groupTotals.get(`${cell.market}|${cell.group}`) || 1);
    personas.push({
      name,
      segment: `${cell.market} · ${cell.segment}`,
      weight: Math.round(share * 1000) / 1000,
      baseSize: base,
      confidence,
      coverageNote:
        base < SMALL_BASE
          ? `This segment has ${base} respondents — too few to support a claim; treat it as illustrative.`
          : null,
      summary:
        `${cell.group} "${cell.segment}" in ${cell.market}${cell.wave ? ` (${cell.wave})` : ''}, base ${base}. ` +
        (above.length
          ? `Stands out most on: ${above.map((x) => `${traitPhrase(x.r.statement, x.r.response)} (+${x.d} pp)`).join('; ')}.`
          : 'Close to the market average on every published statement.'),
      attributes,
    });
  }

  const markets = new Set(ordered.map((c) => c.market)).size;
  const note =
    `One persona per published age and gender segment in each market (${personas.length} across ${markets} market(s)), ` +
    `from the latest wave in ${opts.datasetName}. Each is described by the statements where it differs most from its market as a whole.` +
    (ordered.length > limit ? ` ${ordered.length - limit} further segment(s) were not included (limit ${limit}).` : '');
  return { personas, note };
}
