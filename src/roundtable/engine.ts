/**
 * The simplified journey's two background jobs (server only, runs on the worker).
 *
 *   cast        Build markets × three income tiers from the cleared survey tables, then give each
 *               persona an illustrative identity (name, age, occupation, city, life stage, decision
 *               logic) from one model call that may only draw on the tier's published statistics.
 *   roundtable  Put one question to every persona of the cast. Each answers alone: an openness
 *               score 0–100 for every category, a short quote, conditions, barriers and a profile.
 *               Openness means, bands and featured voices are computed in code; a strategist call
 *               then writes the consensus line, takeaways, communications advice and market reading.
 *
 * Every call goes through `callModel`, recorded against the cast or the roundtable and budget-capped.
 */
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { callModel, ownerSpendUsd } from '@/model/client';
import { deriveSeed } from '@/model/provider';
import { wrapUntrusted, buildEvidenceContext } from '@/model/context';
import { assessUsability } from '@/ingest/pipeline';
import { readVersionTables } from '@/ingest/structured';
import { isLongSurveyTable } from '@/forecast/series';
import { buildCastSeeds, type CastSeed, type CastStat } from '@/server/castBuilder';
import { CastIdentity, RoundtableAnswerShape, RoundtableSummary } from './schemas';
import { band } from './marketIndex';

export const ROUNDTABLE_PROMPT_VERSION = '1.0.0';

export type Lang = 'en' | 'zh';

export interface CastProfile {
  market: string;
  tier: 1 | 2 | 3;
  tierLabel: string;
  basis: 'income' | 'age';
  bands: string[];
  base: number;
  stats: CastStat[];
  identity?: CastIdentity;
}

export interface ScoredCategory {
  category: string;
  score: number;
  reason: string;
}

function languageRule(lang: Lang): string {
  return lang === 'zh'
    ? 'Write every text value in Simplified Chinese. Personal and place names may stay in the local form of the market.'
    : 'Write every text value in English.';
}

function statLine(s: CastStat): string {
  return `${s.id}: "${s.statement}" → ${s.response}: ${s.share}% of this tier vs ${s.overall}% of all adults (+${s.diff} pp, base ${s.base})`;
}

/** The latest usable version of every dataset in the project, read as long survey tables. */
export async function clearedLongTables(projectId: string): Promise<{ name: string; headers: string[]; rows: string[][] }[]> {
  const links = await prisma.projectDataset.findMany({
    where: { projectId, dataset: { deletedAt: null } },
    include: { dataset: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
  });
  const out: { name: string; headers: string[]; rows: string[][] }[] = [];
  for (const link of links) {
    const v = link.dataset.versions[0];
    if (!v || !(await assessUsability(v.id)).usable) continue;
    try {
      await buildEvidenceContext(v.id); // the governance gate: throws if not cleared for model use
    } catch {
      continue;
    }
    for (const t of await readVersionTables(v.id)) {
      if (isLongSurveyTable(t.headers)) out.push({ name: link.dataset.name, headers: t.headers, rows: t.rows });
    }
  }
  return out;
}

// ── Cast ──────────────────────────────────────────────────────────────────────

export interface CastJobInput {
  cohortId: string;
  markets: string[];
  language: Lang;
  context?: string | null;
  seed: number;
}

export async function executeCast(input: CastJobInput): Promise<{ cohortId: string; status: string; personas?: number; reason?: string }> {
  const { cohortId } = input;
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId }, include: { personas: true } });
  if (!cohort) throw new Error(`Cast ${cohortId} does not exist.`);
  if (cohort.buildStatus === 'COMPLETED') return { cohortId, status: 'COMPLETED' };
  await prisma.cohort.update({ where: { id: cohortId }, data: { buildStatus: 'RUNNING', buildError: null } });

  try {
    // Personas are written once; a retried job continues with the identities still missing.
    if (cohort.personas.length === 0) {
      const tables = await clearedLongTables(cohort.projectId);
      if (tables.length === 0) throw new CastFailed('No cleared survey table (market × statement × segment × share) is attached to this project.');
      const { seeds, notes } = buildCastSeeds(tables, input.markets);
      if (seeds.length === 0) throw new CastFailed(notes.join(' ') || 'None of the chosen markets has an income or age break in the data.');
      await writeCast(cohortId, seeds, notes);
    }

    const personas = await prisma.persona.findMany({
      where: { cohortId },
      orderBy: { createdAt: 'asc' },
      include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
    });
    const cap = (await ownerSpendUsd({ cohortId })) + env().AI_RUN_BUDGET_USD;
    let index = 0;
    for (const p of personas) {
      index += 1;
      const v = p.versions[0];
      const profile = (v?.profile ?? null) as CastProfile | null;
      if (!v || !profile || profile.identity) continue;
      const r = await callModel({
        cohortId,
        stage: 'CAST_IDENTITY',
        personaKey: `P${index}`,
        system: [
          'You write the illustrative identity for one consumer persona in a market-entry study.',
          'The persona stands for a whole income tier of a market, described only by the published survey statistics given.',
          'Invent a plausible, ordinary person typical of that tier: a common local name for the market, an age, gender,',
          'occupation and city that fit the tier, a life stage, and the three things that drive their purchase decisions',
          'in order (e.g. "Quality", "Price", "Convenience"). Do not use the name of any real public figure.',
          'Choose the three statistics (by id) that best characterise the tier for a reader.',
          languageRule(input.language),
          'Reply with a single JSON object in the shape you are given. No prose outside it.',
        ].join('\n'),
        messages: [
          {
            role: 'user',
            content: [
              `Market: ${profile.market}`,
              `Tier ${profile.tier} of 3 — ${profile.tierLabel} (${profile.basis === 'income' ? 'household income' : 'age'} bands: ${profile.bands.join('; ')}), base ${profile.base}.`,
              input.context ? wrapUntrusted('study context', input.context) : '',
              'Published statistics for this tier:',
              ...profile.stats.map(statLine),
              `STAT IDS: ${profile.stats.map((s) => s.id).join(' | ')}`,
              '',
              'Respond with JSON: { "name": string, "age": number, "gender": string, "occupation": string, "city": string, "lifeStage": string, ' +
                '"decisionLogic": [string, string, string], "keyStatIds": [string, string, string], "oneLiner": string }',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        schemaName: 'cast_identity',
        schema: CastIdentity,
        seed: deriveSeed(input.seed, 'cast', p.id),
        budgetCapUsd: cap,
        promptTemplate: 'roundtable.cast_identity',
        promptVersion: ROUNDTABLE_PROMPT_VERSION,
      });
      if (!r.ok || !r.value) continue; // the card keeps its statistics and shows initials
      const valid = new Set(profile.stats.map((s) => s.id));
      const picked = r.value.keyStatIds.map((i) => i.trim().toUpperCase()).filter((i) => valid.has(i));
      const identity = { ...r.value, keyStatIds: picked.length ? picked.slice(0, 3) : profile.stats.slice(0, 3).map((s) => s.id) };
      await prisma.$transaction([
        prisma.personaVersion.update({ where: { id: v.id }, data: { profile: { ...profile, identity } as object } }),
        prisma.persona.update({ where: { id: p.id }, data: { name: identity.name } }),
      ]);
    }
    await prisma.cohort.update({ where: { id: cohortId }, data: { buildStatus: 'COMPLETED' } });
    return { cohortId, status: 'COMPLETED', personas: personas.length };
  } catch (e) {
    const reason = e instanceof CastFailed ? e.message : e instanceof Error ? `The cast could not be built: ${e.message}` : 'The cast could not be built.';
    await prisma.cohort.update({ where: { id: cohortId }, data: { buildStatus: 'FAILED', buildError: reason.slice(0, 1000) } });
    return { cohortId, status: 'FAILED', reason };
  }
}

class CastFailed extends Error {}

async function writeCast(cohortId: string, seeds: CastSeed[], notes: string[]): Promise<void> {
  const cohort = await prisma.cohort.findUniqueOrThrow({ where: { id: cohortId } });
  await prisma.$transaction(async (tx) => {
    for (const s of seeds) {
      const persona = await tx.persona.create({ data: { cohortId, type: 'CONSUMER', name: `${s.market} · ${s.tierLabel}` } });
      const confidence = s.base < 30 ? 'LOW' : s.base >= 150 ? 'HIGH' : 'MEDIUM';
      const profile: CastProfile = { market: s.market, tier: s.tier, tierLabel: s.tierLabel, basis: s.basis, bands: s.bands, base: s.base, stats: s.stats };
      const version = await tx.personaVersion.create({
        data: {
          personaId: persona.id,
          versionNo: 1,
          approval: 'CANDIDATE',
          mode: 'CLUSTER',
          segment: `${s.market} · ${s.tierLabel}`,
          baseSize: s.base,
          confidence,
          coverageNote: s.base < 30 ? `This tier has ${s.base} respondents — too few to support a claim; treat it as illustrative.` : null,
          summary: `Tier ${s.tier} (${s.tierLabel}) in ${s.market}: ${s.basis === 'income' ? 'household income' : 'age'} ${s.bands.join(', ')}; base ${s.base}.`,
          profile: profile as object,
        },
      });
      await tx.personaAttribute.createMany({
        data: [
          { personaVersionId: version.id, group: 'segment', key: 'market', label: 'Market', value: s.market, origin: 'OBSERVED', confidence, baseSize: s.base, locked: true },
          { personaVersionId: version.id, group: 'segment', key: 'tier', label: s.basis === 'income' ? 'Household income' : 'Age', value: s.bands.join('; '), origin: 'OBSERVED', confidence, baseSize: s.base, locked: true },
          ...s.stats.map((x) => ({
            personaVersionId: version.id,
            group: 'attitudes',
            key: `${x.statement}|${x.response}`,
            label: `"${x.statement}" → ${x.response}`.slice(0, 200),
            value: `${x.share}% vs ${x.overall}% of all adults in ${s.market} (+${x.diff} pp)`,
            origin: 'OBSERVED' as const,
            confidence,
            baseSize: s.base,
            locked: true,
          })),
        ],
      });
    }
    await tx.cohort.update({
      where: { id: cohortId },
      data: {
        generationNote:
          `Three ${seeds.some((x) => x.basis === 'income') ? 'income' : 'age'} tiers in each of ${new Set(seeds.map((x) => x.market)).size} market(s), ${seeds.length} personas, from the latest wave of the cleared survey tables.` +
          (notes.length ? ` ${notes.join(' ')}` : '') +
          (cohort.generationNote ? ` ${cohort.generationNote}` : ''),
      },
    });
  });
}

// ── Roundtable ────────────────────────────────────────────────────────────────

class RoundtableFailed extends Error {}

/** Match a scored category to one offered, tolerating case, punctuation and a translated label. */
export function matchCategory(name: string, offered: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const n = norm(name);
  return offered.find((o) => norm(o) === n) ?? offered.find((o) => n && (norm(o).includes(n) || n.includes(norm(o)))) ?? null;
}

export async function executeRoundtable(roundtableId: string): Promise<{ roundtableId: string; status: string; reason?: string }> {
  const rt = await prisma.roundtable.findUnique({ where: { id: roundtableId }, include: { answers: true } });
  if (!rt) throw new Error(`Roundtable ${roundtableId} does not exist.`);
  if (rt.status === 'COMPLETED') return { roundtableId, status: 'COMPLETED' };
  const lang: Lang = rt.language === 'zh' ? 'zh' : 'en';

  const personas = await prisma.persona.findMany({
    where: { cohortId: rt.cohortId },
    orderBy: { createdAt: 'asc' },
    include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
  });
  await prisma.roundtable.update({
    where: { id: roundtableId },
    data: { status: 'RUNNING', phase: 'ANSWERS', total: personas.length, startedAt: rt.startedAt ?? new Date(), failureReason: null },
  });
  const cap = (await ownerSpendUsd({ roundtableId })) + env().AI_RUN_BUDGET_USD;
  let isMock = true;

  try {
    const done = new Set(rt.answers.map((a) => a.personaId));
    let index = 0;
    for (const p of personas) {
      index += 1;
      if (done.has(p.id)) continue;
      const profile = (p.versions[0]?.profile ?? null) as CastProfile | null;
      if (!profile) continue;
      const id = profile.identity;
      const r = await callModel({
        roundtableId,
        stage: 'ROUNDTABLE_ANSWER',
        personaKey: `P${index}`,
        system: [
          `You are ${id ? `"${id.name}", ${id.age}, ${id.occupation} in ${id.city} (${id.lifeStage})` : `a consumer from ${profile.market}`} —`,
          `an illustrative persona standing for tier ${profile.tier} of 3 in ${profile.market} (${profile.tierLabel}; ${profile.basis === 'income' ? 'household income' : 'age'} ${profile.bands.join(', ')}; base ${profile.base}).`,
          id ? `What drives your purchase decisions, in order: ${id.decisionLogic.join(' > ')}.` : '',
          'You are a simulation built from published survey statistics for decision support; nothing you say is evidence of',
          'what a real person thinks. Speak in the first person as a typical member of your tier.',
          '',
          'Published statistics for your tier:',
          ...profile.stats.map(statLine),
          '',
          'Rules:',
          '1. Ground your answer in the statistics and in what is typical for your tier and market. Never state a figure that is not given.',
          '2. Score every category from 0 (I would never try a brand like that in this category) to 100 (I would definitely try one).',
          '   Use the whole range and differ between categories where your tier would differ.',
          `3. ${languageRule(lang)}`,
          '4. Reply with a single JSON object in the shape you are given. No prose outside it.',
        ]
          .filter((x) => x !== '')
          .join('\n'),
        messages: [
          {
            role: 'user',
            content: [
              'A market strategist puts one question to a roundtable. Answer alone, as yourself:',
              wrapUntrusted('roundtable question', rt.question),
              rt.context ? wrapUntrusted('study context', rt.context) : '',
              '',
              `CATEGORIES: ${rt.categories.join(' | ')}`,
              'Score every one of these categories, and write each category name exactly as given above (do not translate or rename it).',
              '',
              'Give: a one- or two-sentence quote answering the question in your own voice (under 40 words); a score and a short',
              'reason for every category; the conditions that would make you try; the barriers that would stop you; and a profile —',
              'two to four mindset traits (label and value, e.g. "Brand loyalty": "Low"), how a brand can reach you, what holds you',
              'back, and what brand communications should do to win you.',
              '',
              'Respond with JSON: { "quote": string, "scores": [{ "category": string, "score": 0..100, "reason": string }], "conditions": string[], "barriers": string[], ' +
                '"profile": { "mindset": [{ "label": string, "value": string }], "howToReach": string[], "holdsBack": string[], "commsAdvice": string[] } }',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        schemaName: 'roundtable_answer',
        schema: RoundtableAnswerShape,
        seed: deriveSeed(rt.seed, 'roundtable', p.id),
        budgetCapUsd: cap,
        promptTemplate: 'roundtable.answer',
        promptVersion: ROUNDTABLE_PROMPT_VERSION,
      });
      isMock = r.isMock;
      const base = { roundtableId, personaId: p.id, market: profile.market, tier: profile.tier };
      if (r.ok && r.value) {
        const scores: ScoredCategory[] = [];
        for (const s of r.value.scores) {
          const c = matchCategory(s.category, rt.categories);
          if (c && s.score !== null && !scores.some((x) => x.category === c)) scores.push({ category: c, score: s.score, reason: s.reason });
        }
        const overall = scores.length ? Math.round((scores.reduce((t, s) => t + s.score, 0) / scores.length) * 10) / 10 : null;
        await prisma.roundtableAnswer.create({
          data: { ...base, ok: scores.length > 0, overall, quote: r.value.quote, scores: scores as object, conditions: r.value.conditions, barriers: r.value.barriers, profile: r.value.profile as object },
        });
      } else {
        await prisma.roundtableAnswer.create({ data: { ...base, ok: false, conditions: [], barriers: [] } });
      }
    }

    // ── Summary, from the computed table ──
    await prisma.roundtable.update({ where: { id: roundtableId }, data: { phase: 'SUMMARY' } });
    const answers = await prisma.roundtableAnswer.findMany({ where: { roundtableId, ok: true } });
    if (answers.length === 0) throw new RoundtableFailed('No persona gave a usable answer, so there is nothing to report.');
    const view = roundtableView(rt.categories, answers.map((a) => ({ ...a, scores: (a.scores ?? []) as unknown as ScoredCategory[] })));
    const table = [
      `Question: ${rt.question}`,
      `Openness by market (mean of personas, 0–100): ${view.markets.map((m) => `${m.market} ${Math.round(m.overall)}`).join('; ')}`,
      'Openness by category and market:',
      ...rt.categories.map((c) => `- ${c}: overall ${Math.round(view.categoryMeans[c] ?? 0)}; ${view.markets.map((m) => `${m.market} ${m.categories[c] === undefined ? '—' : Math.round(m.categories[c]!)}`).join(', ')}`),
      'Persona quotes:',
      ...answers.slice(0, 60).map((a) => `- ${a.market}, tier ${a.tier} (openness ${Math.round(a.overall ?? 0)}): ${(a.quote ?? '').slice(0, 300)}`),
      'Most cited barriers:',
      ...answers.flatMap((a) => a.barriers).slice(0, 40).map((b) => `- ${b.slice(0, 200)}`),
    ].join('\n');
    const s = await callModel({
      roundtableId,
      stage: 'ROUNDTABLE_SUMMARY',
      personaKey: 'strategist',
      system: [
        'You are a senior public relations and communications strategist writing up a simulated consumer roundtable for a',
        'market-entry report. The roundtable was answered by illustrative personas built from published survey statistics.',
        'The numbers have been computed for you; do not recompute or invent figures — quote only those given.',
        'Treat the panel as a hypothesis to test in market, not as proof.',
        languageRule(lang),
        'Reply with a single JSON object in the shape you are given. No prose outside it.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            wrapUntrusted('roundtable results', table),
            rt.context ? wrapUntrusted('study context', rt.context) : '',
            `MARKETS: ${view.markets.map((m) => m.market).join(' | ')}`,
            'In "byMarket", write each market name exactly as given above.',
            '',
            'Write: a one-sentence consensus line; three to five key takeaways; a communications recommendation (a headline, up to',
            'four strategic pillars, and one message with channels for each market); and a short market reading (what the',
            'potential, the entry barriers and the entry strategy look like across markets).',
            '',
            'Respond with JSON: { "consensus": string, "takeaways": string[], "comms": { "headline": string, "pillars": [{ "title": string, "detail": string }], ' +
              '"byMarket": [{ "market": string, "message": string, "channels": string[] }] }, "marketReading": { "potential": string[], "entry": string[], "strategy": string[] } }',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      schemaName: 'roundtable_summary',
      schema: RoundtableSummary,
      seed: deriveSeed(rt.seed, 'summary'),
      budgetCapUsd: cap,
      maxTokens: 6000,
      promptTemplate: 'roundtable.summary',
      promptVersion: ROUNDTABLE_PROMPT_VERSION,
    });
    isMock = s.isMock;
    await prisma.roundtable.update({
      where: { id: roundtableId },
      data: {
        status: 'COMPLETED',
        phase: null,
        summary: s.ok && s.value ? (s.value as object) : undefined,
        failureReason: s.ok ? null : `The written summary could not be produced (${s.outcome}); the computed results are complete.`,
        isMock,
        spendUsd: await ownerSpendUsd({ roundtableId }),
        completedAt: new Date(),
      },
    });
    return { roundtableId, status: 'COMPLETED' };
  } catch (e) {
    const reason = e instanceof RoundtableFailed ? e.message : e instanceof Error ? `The roundtable stopped: ${e.message}` : 'The roundtable stopped.';
    await prisma.roundtable.update({
      where: { id: roundtableId },
      data: { status: 'FAILED', phase: null, failureReason: reason.slice(0, 1000), isMock, spendUsd: await ownerSpendUsd({ roundtableId }), completedAt: new Date() },
    });
    return { roundtableId, status: 'FAILED', reason };
  }
}

// ── Computed view ─────────────────────────────────────────────────────────────

export interface AnswerLike {
  personaId: string;
  market: string;
  tier: number;
  overall: number | null;
  quote: string | null;
  scores: ScoredCategory[];
}

export interface RoundtableView {
  markets: { market: string; overall: number; categories: Record<string, number> }[];
  categoryMeans: Record<string, number>;
  /** One voice per market, the persona furthest from the middle — at most five. */
  featured: AnswerLike[];
  bands: Record<'willing' | 'depends' | 'unlikely', number>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function roundtableView(categories: string[], answers: AnswerLike[]): RoundtableView {
  const marketNames = [...new Set(answers.map((a) => a.market))];
  const markets = marketNames.map((market) => {
    const mine = answers.filter((a) => a.market === market);
    const cats: Record<string, number> = {};
    for (const c of categories) {
      const xs = mine.flatMap((a) => a.scores.filter((s) => s.category === c).map((s) => s.score));
      if (xs.length) cats[c] = Math.round(mean(xs) * 10) / 10;
    }
    return { market, overall: Math.round(mean(mine.map((a) => a.overall ?? 0)) * 10) / 10, categories: cats };
  });
  const categoryMeans: Record<string, number> = {};
  for (const c of categories) {
    const xs = answers.flatMap((a) => a.scores.filter((s) => s.category === c).map((s) => s.score));
    if (xs.length) categoryMeans[c] = Math.round(mean(xs) * 10) / 10;
  }
  // Alternate the most and the least open voice across markets, so the slide shows the spread.
  const featured = marketNames
    .map((m, i) => {
      const mine = answers.filter((a) => a.market === m && a.quote);
      const sorted = [...mine].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
      return i % 2 === 0 ? sorted[0] : sorted[sorted.length - 1];
    })
    .filter((a): a is AnswerLike => Boolean(a))
    .slice(0, 5);
  const bands = { willing: 0, depends: 0, unlikely: 0 };
  for (const a of answers) bands[band(a.overall ?? 0)] += 1;
  return { markets, categoryMeans, featured, bands };
}
