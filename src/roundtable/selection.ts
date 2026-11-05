/**
 * Deciding which personas answer a roundtable question (server only).
 *
 * A question about Indonesia's luxury sector should be answered by Indonesian personas, and by those
 * whose profile makes them a plausible luxury buyer — not by every persona in the cast. Two passes:
 *
 *   1. In code: if the question names markets in the cast (by name or demonym), only personas from
 *      those markets are candidates. The model cannot widen this.
 *   2. By the model: from the candidates, activate the personas whose market, tier, life stage and
 *      decision logic make them relevant respondents, with a reason for each decision.
 *
 * The outcome is stored on the roundtable and shown, so the team can see who was asked and why.
 * Failure or an empty answer falls back to every candidate: never to nobody.
 */
import { callModel } from '@/model/client';
import { deriveSeed } from '@/model/provider';
import { wrapUntrusted } from '@/model/context';
import { PersonaSelection } from './schemas';
import { segmentLine, type CastProfile, type Lang } from './engine';

export const SELECTION_PROMPT_VERSION = '1.0.0';
export const MIN_ACTIVE = 3;

export interface Selection {
  mode: 'auto' | 'all';
  method: 'all' | 'market' | 'model';
  markets: string[];
  activated: { personaId: string; reason: string }[];
  skipped: { personaId: string; reason: string }[];
}

const ALIASES: Record<string, string[]> = {
  indonesia: ['indonesian', 'jakarta'], germany: ['german'], 'saudi arabia': ['saudi', 'ksa', 'riyadh'], 'united states': ['american', 'u.s.', 'usa', 'us consumers'],
  usa: ['american', 'u.s.', 'united states'], us: ['american', 'u.s.', 'united states'], brazil: ['brazilian'], china: ['chinese'], 'mainland china': ['chinese', 'china'],
  japan: ['japanese'], 'south korea': ['korean', 'korea'], korea: ['korean'], thailand: ['thai'], vietnam: ['vietnamese'], malaysia: ['malaysian'], singapore: ['singaporean'],
  philippines: ['filipino', 'philippine'], india: ['indian'], uk: ['british', 'united kingdom', 'britain'], 'united kingdom': ['british', 'uk', 'britain'], france: ['french'],
  italy: ['italian'], spain: ['spanish'], mexico: ['mexican'], australia: ['australian'], canada: ['canadian'], turkey: ['turkish', 'türkiye'], uae: ['emirati', 'united arab emirates', 'dubai'],
  egypt: ['egyptian'], nigeria: ['nigerian'], 'south africa': ['south african'], russia: ['russian'], poland: ['polish'], netherlands: ['dutch'], 'hong kong': ['hong kong'], taiwan: ['taiwanese'],
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The markets of the cast that the question names, by country name or demonym. */
export function marketsMentioned(question: string, markets: string[]): string[] {
  const q = question.toLowerCase();
  return markets.filter((m) => {
    const key = m.trim().toLowerCase();
    const names = [key, ...(ALIASES[key] ?? [])];
    return names.some((n) => new RegExp(`(^|[^\\p{L}])${esc(n)}($|[^\\p{L}])`, 'u').test(q)) || (/[一-鿿]/.test(m) && q.includes(m));
  });
}

export interface SelectablePersona {
  id: string;
  profile: CastProfile;
}

export async function selectPersonas(input: {
  roundtableId: string;
  question: string;
  context: string | null;
  categories: string[];
  personas: SelectablePersona[];
  mode: 'auto' | 'all';
  language: Lang;
  seed: number;
  budgetCapUsd: number;
}): Promise<Selection & { isMock: boolean }> {
  const all = input.personas;
  const everyone = (method: Selection['method'], reason: string, markets: string[] = []): Selection & { isMock: boolean } => ({
    mode: input.mode, method, markets, activated: all.map((p) => ({ personaId: p.id, reason })), skipped: [], isMock: true,
  });
  if (input.mode === 'all' || all.length <= MIN_ACTIVE) return everyone('all', input.language === 'zh' ? '全部画像参与。' : 'Everyone was asked.');

  // 1. Markets the question names.
  const named = marketsMentioned(input.question, [...new Set(all.map((p) => p.profile.market))]);
  const candidates = named.length ? all.filter((p) => named.includes(p.profile.market)) : all;
  const outOfMarket = all.filter((p) => !candidates.includes(p)).map((p) => ({
    personaId: p.id,
    reason: input.language === 'zh' ? `问题针对 ${named.join('、')}，该画像来自 ${p.profile.market}。` : `The question is about ${named.join(', ')}; this persona is from ${p.profile.market}.`,
  }));

  // 2. Relevance within the candidates, by the model.
  const line = (p: SelectablePersona, i: number) => {
    const id = p.profile.identity;
    return `P${i + 1} | ${p.profile.market} | ${segmentLine(p.profile)} | ${id ? `${id.age}, ${id.occupation}, ${id.city}; ${id.lifeStage}; drivers ${id.decisionLogic.join(' > ')}` : 'no identity'} | ${p.profile.stats.slice(0, 2).map((s) => `${s.statement} ${s.share}%`).join('; ')}`;
  };
  const r = await callModel({
    roundtableId: input.roundtableId,
    stage: 'ROUNDTABLE_SELECT',
    personaKey: 'selector',
    system: [
      'You decide which personas of a simulated consumer panel should answer one question from a market strategist.',
      'Activate a persona only if it is a relevant respondent: its market is the one the question is about (if any), and its',
      'income tier, life stage, occupation and decision logic make it a plausible buyer or influencer for the category or audience',
      'asked about. For example, a question about the luxury sector in one market is answered by personas of that market with the',
      'means and the appetite for it, not by price-led personas who would not shop the category. A general question, or one about',
      'mass-market or value behaviour, should be answered by all tiers. When unsure, activate.',
      `Activate at least ${MIN_ACTIVE} personas. Give a one-sentence reason for each decision.`,
      input.language === 'zh' ? 'Write every reason in Simplified Chinese.' : 'Write every reason in English.',
      'Reply with a single JSON object in the shape you are given. No prose outside it.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          wrapUntrusted('roundtable question', input.question),
          input.context ? wrapUntrusted('study context', input.context) : '',
          `Categories scored: ${input.categories.join(', ')}`,
          '',
          'Personas (ref | market | segment | person | key statistics):',
          ...candidates.map(line),
          `REFS: ${candidates.map((_, i) => `P${i + 1}`).join(' | ')}`,
          '',
          'Respond with JSON: { "activate": [{ "ref": string, "reason": string }], "skip": [{ "ref": string, "reason": string }] }',
        ].filter(Boolean).join('\n'),
      },
    ],
    schemaName: 'roundtable_selection',
    schema: PersonaSelection,
    seed: deriveSeed(input.seed, 'select', input.roundtableId),
    budgetCapUsd: input.budgetCapUsd,
    promptTemplate: 'roundtable.select',
    promptVersion: SELECTION_PROMPT_VERSION,
  });

  const byRef = new Map(candidates.map((p, i) => [`P${i + 1}`, p]));
  const reasons = new Map<string, { on: boolean; reason: string }>();
  if (r.ok && r.value) {
    for (const a of r.value.activate) { const p = byRef.get(a.ref.trim().toUpperCase()); if (p) reasons.set(p.id, { on: true, reason: a.reason }); }
    for (const s of r.value.skip) { const p = byRef.get(s.ref.trim().toUpperCase()); if (p && !reasons.has(p.id)) reasons.set(p.id, { on: false, reason: s.reason }); }
  }
  let active = candidates.filter((p) => reasons.get(p.id)?.on);
  const modelUsed = active.length >= MIN_ACTIVE || (active.length > 0 && candidates.length <= MIN_ACTIVE);
  if (!modelUsed) active = candidates; // a thin or failed answer never leaves the panel empty
  // Every named market keeps a voice.
  for (const m of named) if (!active.some((p) => p.profile.market === m)) active = [...active, ...candidates.filter((p) => p.profile.market === m)];

  const fallback = input.language === 'zh' ? '与问题相关。' : 'Relevant to the question.';
  const activeIds = new Set(active.map((p) => p.id));
  return {
    mode: input.mode,
    method: modelUsed ? 'model' : named.length ? 'market' : 'all',
    markets: named,
    activated: active.map((p) => ({ personaId: p.id, reason: reasons.get(p.id)?.on ? reasons.get(p.id)!.reason : fallback })),
    skipped: [
      ...outOfMarket,
      ...candidates.filter((p) => !activeIds.has(p.id)).map((p) => ({ personaId: p.id, reason: reasons.get(p.id)?.reason || (input.language === 'zh' ? '与问题关联较弱。' : 'Less relevant to the question.') })),
    ],
    isMock: r.isMock,
  };
}
