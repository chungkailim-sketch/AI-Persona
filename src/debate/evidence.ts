/**
 * What the swarm is allowed to argue from.
 *
 * The motion is typed by a person, so it decides nothing about which data is used beyond ranking
 * statements by relevance. Evidence comes only from dataset versions that have cleared the
 * governance gate, only from fields the review left included, and every item is numbered (`E1`, `E2`
 * …) so an agent cites it by id and the engine can check the citation.
 *
 * Alongside the items, the segment comparison is computed here in code — a two-proportion test on
 * the published bases for every statement both focus segments answered, with a false-discovery
 * correction across the lot. It is the part of the conclusion no model wrote, and the judge is shown
 * it so a debate cannot talk its way past what the numbers say.
 */
import { benjaminiHochberg, twoProportionTest } from '@/forecast/stats';
import { BASE_RESPONSE, isLongSurveyTable } from '@/forecast/series';

export interface EvidenceItem {
  id: string;
  market: string;
  wave: string;
  questionId: string;
  question: string | null;
  statement: string;
  response: string;
  segmentGroup: string;
  segment: string;
  share: number;
  base: number | null;
  source: string;
}

export interface SegmentComparisonRow {
  market: string;
  wave: string;
  statement: string;
  response: string;
  a: { segment: string; share: number; base: number };
  b: { segment: string; share: number; base: number };
  diffPp: number;
  p: number;
  significant: boolean;
}

export interface SegmentComparison {
  segments: [string, string];
  designEffect: number;
  fdr: number;
  rows: SegmentComparisonRow[];
  higherA: number;
  higherB: number;
  noDifference: number;
}

const STOPWORDS = new Set(
  'a an and are as at be but by can could do does for from has have how if in into is it its more most of on or than that the their them there these they this to was were what when which who will with would should whether versus vs between among age group groups year years old aged likely test debate'.split(' '),
);

/** Domain synonyms, so "ChatGPT ads" finds a statement about "adverts from AI assistants". */
const SYNONYMS: Record<string, string[]> = {
  ai: ['ai', 'artificial intelligence', 'chatgpt', 'chatbot', 'assistant', 'generative', 'algorithm', 'gpt', 'gemini', 'copilot'],
  chatgpt: ['ai', 'chatgpt', 'chatbot', 'assistant', 'generative'],
  ad: ['ad', 'ads', 'advert', 'advertising', 'advertisement', 'sponsored', 'promotion', 'promoted', 'marketing', 'commercial'],
  advertising: ['ad', 'ads', 'advert', 'advertising', 'advertisement', 'sponsored', 'promotion', 'marketing'],
  trust: ['trust', 'trusted', 'trustworthy', 'reliable', 'believe', 'credible', 'honest', 'confidence'],
  bias: ['bias', 'biased', 'favour', 'favor', 'sponsored', 'neutral', 'objective', 'fair', 'impartial'],
  sponsored: ['sponsored', 'paid', 'promoted', 'advert', 'ad'],
  susceptible: ['influence', 'influenced', 'persuade', 'persuaded', 'buy', 'purchase', 'recommendation', 'recommend'],
  privacy: ['privacy', 'personal data', 'data', 'tracking'],
};

function stem(w: string): string {
  return w.replace(/(ing|ers|er|ed|es|s)$/, '');
}

/** Search terms from the motion and hypothesis, expanded with the synonyms above. */
export function topicTerms(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d/.test(w));
  const terms = new Set<string>();
  for (const w of words) {
    terms.add(w);
    for (const [k, syns] of Object.entries(SYNONYMS)) {
      if (stem(w) === stem(k) || syns.some((s) => stem(s) === stem(w))) syns.forEach((s) => terms.add(s));
    }
  }
  return [...terms];
}

export function relevance(text: string, terms: readonly string[]): number {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')} `;
  let score = 0;
  for (const term of terms) {
    // Short terms ("ad", "ai") only as whole words, or "ad" would match "adult" and "address".
    const hit =
      term.includes(' ') || term.length <= 3
        ? t.includes(` ${term} `) || t.includes(` ${term}s `)
        : t.includes(` ${stem(term)}`);
    if (hit) score += term.length <= 3 ? 1.5 : 1;
  }
  return score;
}

// ── Segments ──────────────────────────────────────────────────────────────────

/** "25-34" → [25, 34]; "55+" → [55, 120]; anything else → null. */
export function ageRange(s: string): [number, number] | null {
  const m = /(\d{2})\s*(?:-|–|to)\s*(\d{2})/.exec(s);
  if (m) return [Number(m[1]), Number(m[2])];
  const plus = /(\d{2})\s*\+/.exec(s);
  if (plus) return [Number(plus[1]), 120];
  return null;
}

/** Age ranges mentioned in free text, in order of mention. */
export function mentionedRanges(text: string): string[] {
  const out: string[] = [];
  // No trailing word boundary: people write "15-24s" as often as "15-24".
  for (const m of text.matchAll(/\b(\d{2})\s*(?:-|–|to)\s*(\d{2})(?!\d)|\b(\d{2})\s*\+/g)) out.push(m[0].replace(/\s+/g, ''));
  return [...new Set(out)];
}

/**
 * Map what a person asked for onto the segments the data publishes. "15-24" matches a published
 * "16-24" (the closest overlapping break), and the mapping is reported, never silent.
 */
export function matchSegments(requested: readonly string[], available: readonly string[]): { requested: string; matched: string | null; note: string | null }[] {
  return requested.map((r) => {
    const exact = available.find((a) => a.trim().toLowerCase() === r.trim().toLowerCase());
    if (exact) return { requested: r, matched: exact, note: null };
    const rr = ageRange(r);
    if (!rr) return { requested: r, matched: null, note: `No published segment is called "${r}".` };
    let best: { seg: string; overlap: number } | null = null;
    for (const a of available) {
      const ar = ageRange(a);
      if (!ar) continue;
      const overlap = Math.min(rr[1], ar[1]) - Math.max(rr[0], ar[0]);
      const union = Math.max(rr[1], ar[1]) - Math.min(rr[0], ar[0]);
      const score = overlap / union;
      if (overlap >= 0 && (!best || score > best.overlap)) best = { seg: a, overlap: score };
    }
    if (!best || best.overlap < 0.5) return { requested: r, matched: null, note: `No published age break overlaps "${r}" closely enough.` };
    return { requested: r, matched: best.seg, note: `"${r}" is not a published break; the closest, "${best.seg}", is used.` };
  });
}

// ── Selecting evidence from a long survey table ──────────────────────────────

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export interface LongTableInput {
  source: string;
  headers: string[];
  rows: string[][];
  questionText: Map<string, string>;
}

interface Row {
  market: string; wave: string; t: number; questionId: string; statement: string; response: string;
  group: string; segment: string; share: number; base: number | null;
}

function rowsOf(input: LongTableInput): Row[] {
  const c = (n: string) => input.headers.findIndex((h) => h.trim().toLowerCase() === n);
  const ix = {
    market: c('market'), wave: c('wave'), year: c('wave_year'), month: c('wave_month'), q: c('question_id'),
    statement: c('statement'), response: c('response'), group: c('segment_group'), segment: c('segment'),
    base: c('sample_base'), share: c('share'),
  };
  const out: Row[] = [];
  for (const r of input.rows) {
    const share = Number(r[ix.share]);
    const year = Number(r[ix.year]);
    const mi = MONTHS.indexOf((r[ix.month] ?? '').trim().toLowerCase());
    const response = (r[ix.response] ?? '').trim();
    if (!Number.isFinite(share) || share < 0 || share > 100 || BASE_RESPONSE.test(response)) continue;
    const base = ix.base >= 0 ? Number(r[ix.base]) : NaN;
    out.push({
      market: ix.market >= 0 ? (r[ix.market] ?? '').trim() : '',
      wave: ix.wave >= 0 ? (r[ix.wave] ?? '').trim() : `${r[ix.month]} ${r[ix.year]}`,
      t: Number.isFinite(year) && mi >= 0 ? year * 12 + mi : 0,
      questionId: ix.q >= 0 ? (r[ix.q] ?? '').trim() : '',
      statement: (r[ix.statement] ?? '').trim(),
      response,
      group: (r[ix.group] ?? '').trim(),
      segment: (r[ix.segment] ?? '').trim(),
      share,
      base: Number.isFinite(base) && base > 0 ? base : null,
    });
  }
  return out;
}

export interface SelectedEvidence {
  items: EvidenceItem[];
  statementsConsidered: number;
  statementsSelected: { questionId: string; statement: string; question: string | null; score: number }[];
  segmentsAvailable: string[];
  focus: { requested: string; matched: string | null; note: string | null }[];
  comparison: SegmentComparison | null;
  notes: string[];
}

export function selectEvidence(
  tables: readonly LongTableInput[],
  opts: { topic: string; focusRequested: readonly string[]; maxStatements?: number; maxItems?: number },
): SelectedEvidence {
  const terms = topicTerms(opts.topic);
  const maxStatements = opts.maxStatements ?? 10;
  const maxItems = opts.maxItems ?? 160;
  const notes: string[] = [];

  const all: (Row & { source: string; question: string | null })[] = [];
  for (const t of tables) {
    if (!isLongSurveyTable(t.headers)) continue;
    for (const r of rowsOf(t)) all.push({ ...r, source: t.source, question: t.questionText.get(r.questionId) ?? null });
  }
  const segmentsAvailable = [...new Set(all.filter((r) => /age/i.test(r.group)).map((r) => r.segment))].sort();
  const focus = matchSegments(opts.focusRequested, [...new Set(all.map((r) => r.segment))]);
  for (const f of focus) if (f.note) notes.push(f.note);
  const focusSegs = focus.map((f) => f.matched).filter((s): s is string => Boolean(s));

  // Rank each distinct statement by how much its wording (and its question's) matches the motion.
  const byStatement = new Map<string, { questionId: string; statement: string; question: string | null; score: number }>();
  for (const r of all) {
    const key = `${r.questionId}|${r.statement}`;
    if (byStatement.has(key)) continue;
    const score = relevance(r.statement, terms) * 2 + relevance(r.question ?? '', terms);
    byStatement.set(key, { questionId: r.questionId, statement: r.statement, question: r.question, score });
  }
  const ranked = [...byStatement.values()].filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.questionId.localeCompare(b.questionId));
  const selected = ranked.slice(0, maxStatements);
  if (selected.length === 0) {
    notes.push('No statement in the cleared data mentions the motion’s subject. The swarm is told so and cannot cite anything.');
  }

  // Latest wave per market: the debate is about now, and older waves are the trend panel's job.
  const latest = new Map<string, number>();
  for (const r of all) latest.set(r.market, Math.max(latest.get(r.market) ?? 0, r.t));
  const wanted = new Set(selected.map((s) => `${s.questionId}|${s.statement}`));
  const segmentOk = (r: Row) =>
    r.group.toLowerCase() === 'all' || (focusSegs.length > 0 ? focusSegs.includes(r.segment) : /age/i.test(r.group));
  const pool = all.filter((r) => wanted.has(`${r.questionId}|${r.statement}`) && r.t === latest.get(r.market) && segmentOk(r));

  // Keep the order of relevance, and within a statement the order the data gives.
  const rank = new Map(selected.map((s, i) => [`${s.questionId}|${s.statement}`, i]));
  pool.sort((a, b) => rank.get(`${a.questionId}|${a.statement}`)! - rank.get(`${b.questionId}|${b.statement}`)! || a.market.localeCompare(b.market));
  if (pool.length > maxItems) notes.push(`${pool.length} matching figures; the ${maxItems} most relevant are shown to the swarm.`);
  const items: EvidenceItem[] = pool.slice(0, maxItems).map((r, i) => ({
    id: `E${i + 1}`,
    market: r.market,
    wave: r.wave,
    questionId: r.questionId,
    question: r.question,
    statement: r.statement,
    response: r.response,
    segmentGroup: r.group,
    segment: r.segment,
    share: r.share,
    base: r.base,
    source: r.source,
  }));

  const comparison = focusSegs.length >= 2 ? compareSegments(pool, focusSegs[0]!, focusSegs[1]!) : null;
  if (opts.focusRequested.length >= 2 && !comparison) notes.push('Two comparable segments could not both be found in the data, so no segment comparison was computed.');

  return { items, statementsConsidered: byStatement.size, statementsSelected: selected, segmentsAvailable, focus, comparison, notes };
}

/** Two-proportion tests for segment A against B on every figure both answered, FDR-corrected. */
export function compareSegments(
  rows: readonly { market: string; wave: string; statement: string; response: string; segment: string; share: number; base: number | null }[],
  a: string,
  b: string,
  designEffect = 1.5,
  fdr = 0.05,
): SegmentComparison {
  const key = (r: { market: string; wave: string; statement: string; response: string }) => `${r.market}|${r.wave}|${r.statement}|${r.response}`;
  const as = new Map(rows.filter((r) => r.segment === a && r.base).map((r) => [key(r), r]));
  const pairs: { ra: (typeof rows)[number]; rb: (typeof rows)[number] }[] = [];
  for (const rb of rows) {
    if (rb.segment !== b || !rb.base) continue;
    const ra = as.get(key(rb));
    if (ra) pairs.push({ ra, rb });
  }
  const tests = pairs.map(({ ra, rb }) => twoProportionTest(rb.share, rb.base!, ra.share, ra.base!, designEffect));
  const sig = benjaminiHochberg(tests.map((t) => t?.p ?? 1), fdr);
  const out: SegmentComparisonRow[] = pairs.map(({ ra, rb }, i) => ({
    market: ra.market,
    wave: ra.wave,
    statement: ra.statement,
    response: ra.response,
    a: { segment: a, share: ra.share, base: ra.base! },
    b: { segment: b, share: rb.share, base: rb.base! },
    // Positive when segment A is higher.
    diffPp: tests[i]?.diffPp ?? 0,
    p: tests[i]?.p ?? 1,
    significant: sig[i]!,
  }));
  return {
    segments: [a, b],
    designEffect,
    fdr,
    rows: out,
    higherA: out.filter((r) => r.significant && r.diffPp > 0).length,
    higherB: out.filter((r) => r.significant && r.diffPp < 0).length,
    noDifference: out.filter((r) => !r.significant).length,
  };
}

// ── Rendering for prompts ─────────────────────────────────────────────────────

export function renderEvidenceItems(items: readonly EvidenceItem[]): string {
  if (items.length === 0) return 'No evidence item addresses the motion. Say so rather than arguing from general knowledge.';
  const lines: string[] = [];
  let last = '';
  for (const e of items) {
    const head = `${e.questionId} "${e.statement}" [${e.market}, ${e.wave}]`;
    if (head !== last) {
      lines.push(`\n${head}${e.question ? `\n  question: ${e.question.slice(0, 240)}` : ''}`);
      last = head;
    }
    lines.push(`  ${e.id}: ${e.segment} (${e.segmentGroup}) → "${e.response}" ${e.share}%${e.base ? ` (base ${e.base})` : ' (base not published)'}`);
  }
  return lines.join('\n').trim();
}

export function renderComparison(c: SegmentComparison | null): string {
  if (!c) return 'No segment comparison was computed.';
  const top = [...c.rows].sort((x, y) => x.p - y.p).slice(0, 12);
  return [
    `Computed in code (two-proportion test, design effect ${c.designEffect}, false-discovery rate ${c.fdr}):`,
    `${c.segments[0]} significantly higher on ${c.higherA} figure(s), ${c.segments[1]} higher on ${c.higherB}, no detectable difference on ${c.noDifference}.`,
    ...top.map((r) => `- [${r.market}, ${r.wave}] "${r.statement}" → "${r.response}": ${r.a.segment} ${r.a.share}% (n=${r.a.base}) vs ${r.b.segment} ${r.b.share}% (n=${r.b.base}); diff ${r.diffPp > 0 ? '+' : ''}${r.diffPp} pp, p=${r.p}${r.significant ? ' (significant)' : ''}`),
  ].join('\n');
}
