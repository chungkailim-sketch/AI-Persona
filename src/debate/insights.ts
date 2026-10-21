/**
 * What can be made from a completed swarm debate (server only, runs on the worker).
 *
 *   PANEL_QUESTION  one question put to every persona agent of the debate, each answering alone,
 *                   grounded in the debate's evidence plus evidence gathered for the question.
 *                   Category ratings are counted in code, per category and per market.
 *   COMMS_REPORT    a market-entry PR and communications strategy written by a strategist agent
 *                   from the whole focus group: verdict, final positions, panel answers, evidence.
 *   SELF_INTRO      a persona agent introducing itself, in the first person.
 *   INTERVIEW       one strategist question to one persona agent, answered with the earlier
 *                   questions and answers in that conversation as context.
 *
 * Every answer goes through `callModel`: recorded against the debate, budget-checked, validated,
 * and cited by evidence id. A persona answering beyond the evidence must say so.
 */
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { callModel, debateSpendUsd } from '@/model/client';
import { deriveSeed } from '@/model/provider';
import { wrapUntrusted } from '@/model/context';
import type { DebateAgent } from './crew';
import { renderEvidenceItems, type EvidenceItem } from './evidence';
import { gatherDebateEvidence } from './sources';
import { describeFailure } from './engine';
import { assessUsability } from '@/ingest/pipeline';
import { buildEvidenceContext } from '@/model/context';
import { readVersionTables } from '@/ingest/structured';
import { isLongSurveyTable } from '@/forecast/series';
import { generateLongTableCohort } from '@/server/longCohort';
import {
  CommsReport,
  DEFAULT_CATEGORIES,
  InterviewAnswer,
  LIKELIHOODS,
  PanelAnswer,
  SelfIntro,
  type Likelihood,
} from './insightSchemas';

export const INSIGHT_PROMPT_VERSION = '1.0.0';
export type InsightKind = 'PANEL_QUESTION' | 'COMMS_REPORT' | 'SELF_INTRO' | 'INTERVIEW';

const SHAPE = {
  panel:
    '{ "answer": string, "categories": [{ "category": string, "likelihood": "very_likely" | "likely" | "unlikely" | "would_not", "reason": string, "evidenceIds": string[] }], ' +
    '"conditions": string[], "barriers": string[], "confidence": 0..1 }',
  report:
    '{ "title": string, "executiveSummary": string, "situation": string, "objectives": string[], ' +
    '"audienceInsights": [{ "segment": string, "insight": string, "implication": string, "evidenceIds": string[] }], "positioning": string, ' +
    '"keyMessages": [{ "message": string, "audience": string, "proofPoints": string[] }], "channels": [{ "channel": string, "role": string, "rationale": string }], ' +
    '"voices": [{ "voice": string, "why": string }], "phasedPlan": [{ "phase": string, "timing": string, "objective": string, "activities": string[] }], ' +
    '"risks": [{ "risk": string, "likelihood": "high" | "medium" | "low", "mitigation": string }], "kpis": [{ "kpi": string, "target": string, "measurement": string }], "limitations": string[] }',
  intro:
    '{ "headline": string, "introduction": string, "aboutMe": string[], "whatIValue": string[], "viewOnTheTopic": string, "howToReachMe": string[], "evidenceIds": string[] }',
  interview: '{ "answer": string, "confidence": 0..1, "evidenceIds": string[], "outsideEvidence": boolean }',
};

interface Attribute {
  label: string;
  value: string;
  origin: string;
  baseSize: number | null;
}

type PanelPersona = DebateAgent & { attributes: Attribute[] };

interface Loaded {
  debate: NonNullable<Awaited<ReturnType<typeof loadDebate>>>;
  personas: PanelPersona[];
  items: EvidenceItem[];
  verdictText: string;
}

async function loadDebate(debateId: string) {
  return prisma.debate.findUnique({ where: { id: debateId }, include: { turns: { orderBy: { seq: 'asc' } } } });
}

async function load(debateId: string): Promise<Loaded> {
  const debate = await loadDebate(debateId);
  if (!debate) throw new Error(`Debate ${debateId} does not exist.`);
  const agents = ((debate.agents ?? []) as unknown as DebateAgent[]).filter((a) => a.kind === 'persona');
  const rows = await prisma.persona.findMany({
    where: { id: { in: agents.map((a) => a.personaId).filter((x): x is string => Boolean(x)) } },
    include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, include: { attributes: true } } },
  });
  const attrs = new Map(
    rows.map((p) => [
      p.id,
      (p.versions[0]?.attributes ?? []).slice(0, 14).map((a) => ({ label: a.label, value: a.value, origin: a.origin, baseSize: a.baseSize })),
    ]),
  );
  const evidence = (debate.evidence ?? {}) as { items?: EvidenceItem[] };
  const verdict = ((debate.conclusion ?? {}) as { verdict?: Record<string, unknown> }).verdict ?? null;
  const list = (k: string) => (Array.isArray(verdict?.[k]) ? (verdict![k] as unknown[]).map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n') : '');
  const verdictText = verdict
    ? [
        `Verdict: ${String(verdict.answer ?? '')} (${String(verdict.confidence ?? '')} confidence)`,
        String(verdict.conclusion ?? ''),
        list('segmentFindings') && `Segment findings:\n${list('segmentFindings')}`,
        list('consensus') && `Consensus:\n${list('consensus')}`,
        list('dissent') && `Dissent:\n${list('dissent')}`,
        list('evidenceGaps') && `Evidence gaps:\n${list('evidenceGaps')}`,
        list('recommendations') && `Judge's recommendations:\n${list('recommendations')}`,
      ]
        .filter(Boolean)
        .join('\n')
    : 'The debate reached no verdict.';
  return {
    debate,
    personas: agents.map((a) => ({ ...a, attributes: a.personaId ? (attrs.get(a.personaId) ?? []) : [] })),
    items: evidence.items ?? [],
    verdictText,
  };
}

function marketOf(segment: string | null | undefined): string {
  return segment?.includes(' · ') ? segment.split(' · ')[0]!.trim() : 'All markets';
}

/** What this agent said in the debate, in order — its memory of the focus group. */
function debateRecord(l: Loaded, agentKey: string): string {
  const lines = l.debate.turns
    .filter((t) => t.agentKey === agentKey && t.ok)
    .map((t) => {
      const c = t.content as Record<string, unknown>;
      const said = String(c.finalArgument ?? c.argument ?? c.rebuttal ?? '').slice(0, 700);
      return `- ${t.phase.toLowerCase()}${t.round ? ` (round ${t.round})` : ''}${t.stance ? `, ${t.stance}` : ''}: ${said}`;
    });
  return lines.length ? lines.join('\n') : '- (no recorded contribution)';
}

function personaSystem(agent: PanelPersona, l: Loaded, extraEvidence: EvidenceItem[] = [], inDebate = true): string {
  return [
    `You are "${agent.name}", a simulated consumer persona built from published survey data for a market-entry study.`,
    'Speak in the first person, as a typical member of the segment you represent — not as an assistant, and not as',
    'any individual real person. You are a simulation for decision support; nothing you say is evidence of what a real',
    'person thinks.',
    '',
    '## Who you represent',
    agent.backstory,
    agent.baseSize ? `Your segment's base in the data is ${agent.baseSize}.` : '',
    'What is known about your segment ("observed" was measured; "inferred" and "simulated" measure nothing):',
    ...agent.attributes.map((a) => `- [${a.origin.toLowerCase()}] ${a.label}: ${a.value}${a.baseSize ? ` (base ${a.baseSize})` : ''}`),
    '',
    '## The focus group you took part in',
    wrapUntrusted('debate motion', l.debate.topic),
    ...(inDebate
      ? ['What you said:', debateRecord(l, agent.key)]
      : ['You were not on this panel, but you have read its conclusion and represent a segment of the same data.']),
    '',
    "The judge's reference conclusion:",
    l.verdictText,
    '',
    '## Evidence items',
    renderEvidenceItems(l.items),
    extraEvidence.length ? `\n## Evidence gathered for this question\n${renderEvidenceItems(extraEvidence)}` : '',
    '',
    '## Rules',
    '1. Ground what you say in the evidence items and your segment attributes, and cite items by id (e.g. "E4", "Q2").',
    '   Never state a figure that is not in them.',
    '2. When a question goes beyond the evidence, you may answer as your segment would plausibly feel, but say so',
    '   plainly and keep your confidence low.',
    '3. Stay consistent with what you said in the focus group unless you give a reason to differ.',
    '4. Reply with a single JSON object in the shape you are given. No prose outside it.',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

function strategistSystem(): string {
  return [
    'You are a senior public relations and communications strategist preparing a market-entry communications strategy',
    'for a brand entering new markets. You are working from a simulated consumer focus group (an agent-swarm debate',
    'whose persona agents were built from published survey segments) and the survey evidence the panel was shown.',
    '',
    'Rules:',
    '1. Every audience insight must rest on the evidence or on what the panel said; cite evidence items by id.',
    '2. The panel is simulated. Treat its agreement as a hypothesis to test in market, not as proof, and say so in',
    '   the limitations.',
    '3. Be specific and practical: name markets, segments, channels, messages and phases. Avoid generic advice.',
    '4. Reply with a single JSON object in the shape you are given. No prose outside it.',
  ].join('\n');
}

function citeFilter(valid: Set<string>) {
  return (ids: string[] | undefined) => [...new Set((ids ?? []).map((i) => i.trim().toUpperCase()))].filter((i) => valid.has(i));
}

const CATEGORY_KEYS = new Map(DEFAULT_CATEGORIES.map((c) => [c.toLowerCase(), c as string]));
function normaliseCategory(c: string, offered: string[]): string {
  const k = c.trim().toLowerCase();
  return offered.find((o) => o.toLowerCase() === k) ?? CATEGORY_KEYS.get(k) ?? c.trim().replace(/\s+/g, ' ');
}

export interface CategoryTally {
  category: string;
  counts: Record<Likelihood, number>;
  rated: number;
  /** Share of personas who rated it very likely or likely, of all personas that answered. */
  willingShare: number;
  byMarket: { market: string; willing: number; answered: number }[];
}

export function tallyCategories(
  answers: { market: string; ok: boolean; categories?: { category: string; likelihood: Likelihood }[] }[],
): CategoryTally[] {
  const answered = answers.filter((a) => a.ok);
  const perMarket = new Map<string, number>();
  for (const a of answered) perMarket.set(a.market, (perMarket.get(a.market) ?? 0) + 1);
  const by = new Map<string, CategoryTally & { m: Map<string, number> }>();
  for (const a of answered) {
    for (const c of a.categories ?? []) {
      const t =
        by.get(c.category) ??
        ({ category: c.category, counts: { very_likely: 0, likely: 0, unlikely: 0, would_not: 0 }, rated: 0, willingShare: 0, byMarket: [], m: new Map() } as CategoryTally & { m: Map<string, number> });
      t.counts[c.likelihood] += 1;
      t.rated += 1;
      if (c.likelihood === 'very_likely' || c.likelihood === 'likely') t.m.set(a.market, (t.m.get(a.market) ?? 0) + 1);
      by.set(c.category, t);
    }
  }
  return [...by.values()]
    .map(({ m, ...t }) => ({
      ...t,
      willingShare: answered.length ? (t.counts.very_likely + t.counts.likely) / answered.length : 0,
      byMarket: [...perMarket.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([market, n]) => ({ market, willing: m.get(market) ?? 0, answered: n })),
    }))
    .sort((a, b) => b.willingShare - a.willingShare || b.counts.very_likely - a.counts.very_likely || a.category.localeCompare(b.category));
}

const MAX_DATA_PANEL = 40;

/**
 * A panel built from the cleared data on the segment groups chosen (income, region, …) rather than
 * the debate's age and gender personas. One persona per published segment per market; when several
 * datasets publish the same segment, their attributes are pooled into one persona.
 */
async function dataPanel(projectId: string, o: { groups: string[]; markets: string[]; max: number; seed: number }): Promise<PanelPersona[]> {
  const links = await prisma.projectDataset.findMany({
    where: { projectId, dataset: { deletedAt: null } },
    include: { dataset: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
  });
  const merged = new Map<string, PanelPersona>();
  for (const link of links) {
    const v = link.dataset.versions[0];
    if (!v || !(await assessUsability(v.id)).usable) continue;
    try {
      await buildEvidenceContext(v.id); // the governance gate: throws if not cleared for model use
    } catch {
      continue;
    }
    const table = (await readVersionTables(v.id)).find((t) => isLongSurveyTable(t.headers));
    if (!table) continue;
    const built = generateLongTableCohort(table, { datasetName: link.dataset.name, seed: o.seed, groups: o.groups, markets: o.markets, maxPersonas: o.max });
    for (const p of built?.personas ?? []) {
      const existing = merged.get(p.segment);
      const attrs = p.attributes.map((a) => ({ label: a.label, value: a.value, origin: a.origin, baseSize: a.baseSize }));
      if (existing) {
        const have = new Set(existing.attributes.map((a) => a.label));
        existing.attributes.push(...attrs.filter((a) => !have.has(a.label)));
        existing.attributes = existing.attributes.slice(0, 20);
        continue;
      }
      if (merged.size >= o.max) continue;
      merged.set(p.segment, {
        key: `D${merged.size + 1}`,
        name: p.name,
        kind: 'persona',
        segment: p.segment,
        baseSize: p.baseSize,
        role: `Consumer segment persona: ${p.segment}`,
        goal: 'Answer as this segment would, grounded in what the data shows about it.',
        backstory: p.summary,
        attributes: attrs,
      });
    }
  }
  return [...merged.values()];
}

// ── Execution ─────────────────────────────────────────────────────────────────

export async function executeInsight(artifactId: string): Promise<{ artifactId: string; status: string; reason?: string }> {
  const artifact = await prisma.debateArtifact.findUnique({ where: { id: artifactId } });
  if (!artifact) throw new Error(`Artifact ${artifactId} does not exist.`);
  if (artifact.status === 'COMPLETED') return { artifactId, status: 'COMPLETED' };
  await prisma.debateArtifact.update({ where: { id: artifactId }, data: { status: 'RUNNING', failureReason: null } });

  const startSpend = await debateSpendUsd(artifact.debateId);
  const cap = startSpend + env().AI_RUN_BUDGET_USD;
  let spend = 0;

  try {
    const l = await load(artifact.debateId);
    const opts = (artifact.options ?? {}) as Record<string, unknown>;
    const seedFor = (...parts: string[]) => deriveSeed(l.debate.seed, 'insight', artifactId, ...parts);
    let content: unknown;
    let evidence: unknown = null;

    if (artifact.kind === 'PANEL_QUESTION') {
      const question = artifact.prompt ?? '';
      // Who answers: the debate's persona agents, or a panel built from the data on other breaks.
      const fromData = opts.panel === 'data';
      const panel = fromData
        ? await dataPanel(l.debate.projectId, {
            groups: Array.isArray(opts.segmentGroups) ? (opts.segmentGroups as string[]) : [],
            markets: Array.isArray(opts.markets) ? (opts.markets as string[]) : [],
            max: Math.min(MAX_DATA_PANEL, Math.max(2, Number(opts.maxPersonas) || 24)),
            seed: l.debate.seed,
          })
        : l.personas;
      if (panel.length === 0) throw new InsightFailed('No published segment matches that choice of segment groups and markets in the cleared data.');
      const offered = Array.isArray(opts.categories) && opts.categories.length ? (opts.categories as string[]) : [...DEFAULT_CATEGORIES];
      // Evidence chosen for this question, in addition to what the debate was shown. Re-labelled Q1…
      let extra: EvidenceItem[] = [];
      try {
        const g = await gatherDebateEvidence(l.debate.projectId, `${question} ${offered.join(' ')}`, fromData ? [] : l.debate.focusSegments);
        extra = g.selected.items.map((e, i) => ({ ...e, id: `Q${i + 1}` }));
      } catch {
        extra = [];
      }
      evidence = { items: extra };
      const cite = citeFilter(new Set([...l.items, ...extra].map((e) => e.id)));
      const answers = [];
      for (const p of panel) {
        const r = await callModel({
          debateId: l.debate.id,
          stage: 'INSIGHT_PANEL_QUESTION',
          personaKey: p.key,
          system: personaSystem(p, l, extra, !fromData),
          messages: [
            {
              role: 'user',
              content: [
                'A market strategist puts this question to every member of the panel. Answer alone, as yourself:',
                wrapUntrusted('strategist question', question),
                '',
                `Rate each of these categories that you have a view on (you may add up to two others): ${offered.join('; ')}.`,
                'Use "very_likely", "likely", "unlikely" or "would_not". Give a reason grounded in your segment for each, and',
                'list the conditions that would make you try, and the barriers that would stop you.',
                '',
                `Respond with JSON: ${SHAPE.panel}`,
              ].join('\n'),
            },
          ],
          schemaName: 'panel_answer',
          schema: PanelAnswer,
          seed: seedFor(p.key),
          budgetCapUsd: cap,
          promptTemplate: 'insight.panel_question',
          promptVersion: INSIGHT_PROMPT_VERSION,
        });
        spend += r.costUsd;
        const base = { agentKey: p.key, name: p.name, segment: p.segment ?? null, market: marketOf(p.segment), baseSize: p.baseSize ?? null };
        if (r.ok && r.value) {
          answers.push({
            ...base,
            ok: true,
            ...r.value,
            categories: r.value.categories
              .filter((c) => (LIKELIHOODS as readonly string[]).includes(c.likelihood))
              .map((c) => ({ ...c, category: normaliseCategory(c.category, offered), evidenceIds: cite(c.evidenceIds) })),
          });
        } else {
          answers.push({ ...base, ok: false, outcome: r.outcome });
        }
      }
      content = {
        question,
        categories: offered,
        panel: fromData
          ? { source: 'data', segmentGroups: opts.segmentGroups ?? [], markets: opts.markets ?? [] }
          : { source: 'debate' },
        answers,
        tally: tallyCategories(answers),
      };
    } else if (artifact.kind === 'COMMS_REPORT') {
      const panel = await prisma.debateArtifact.findFirst({
        where: { debateId: l.debate.id, kind: 'PANEL_QUESTION', status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
      });
      const panelText = panel
        ? (() => {
            const c = panel.content as unknown as { question: string; tally: CategoryTally[] };
            return [
              `Question put to the panel: ${c.question}`,
              ...c.tally.slice(0, 12).map(
                (t) =>
                  `- ${t.category}: ${Math.round(t.willingShare * 100)}% of personas willing (very likely ${t.counts.very_likely}, likely ${t.counts.likely}, unlikely ${t.counts.unlikely}, would not ${t.counts.would_not}); by market ${t.byMarket.map((m) => `${m.market} ${m.willing}/${m.answered}`).join(', ')}`,
              ),
            ].join('\n');
          })()
        : 'No panel question has been asked of this debate.';
      const positions = l.personas
        .map((p) => {
          const closing = [...l.debate.turns].reverse().find((t) => t.agentKey === p.key && t.phase === 'CLOSING' && t.ok);
          const c = (closing?.content ?? {}) as Record<string, unknown>;
          return `- ${p.key} ${p.name} (${p.segment ?? 'segment not stated'}): ${closing?.stance ?? 'no closing'} — ${String(c.finalArgument ?? '').slice(0, 500)}`;
        })
        .join('\n');
      const brief = [
        opts.brand ? `Brand: ${String(opts.brand)}` : '',
        opts.category ? `Category / product: ${String(opts.category)}` : '',
        opts.markets ? `Target markets: ${String(opts.markets)}` : '',
        opts.objective ? `Business objective: ${String(opts.objective)}` : '',
        artifact.prompt ? `Further brief: ${artifact.prompt}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const valid = new Set(l.items.map((e) => e.id));
      const r = await callModel({
        debateId: l.debate.id,
        stage: 'INSIGHT_COMMS_REPORT',
        personaKey: 'strategist',
        system: strategistSystem(),
        messages: [
          {
            role: 'user',
            content: [
              'Write a market-entry public relations and communications strategy report from this focus group.',
              '',
              '## Brief',
              wrapUntrusted('report brief', brief || 'No brief given: infer the entering brand type from the motion.'),
              '',
              '## Focus group motion',
              wrapUntrusted('debate motion', `${l.debate.topic}${l.debate.hypothesis ? `\nHypothesis: ${l.debate.hypothesis}` : ''}`),
              '',
              '## Reference conclusion',
              l.verdictText,
              '',
              '## Final positions of the persona agents',
              positions,
              '',
              '## Panel question results (counted in code)',
              panelText,
              '',
              '## Evidence items',
              renderEvidenceItems(l.items),
              '',
              'Keep it tight so the whole report fits in one answer: each text field under about 150 words, and at most',
              '6 items in any list. Fill every field; use an empty list rather than leaving a field out.',
              '',
              `Respond with JSON: ${SHAPE.report}`,
            ].join('\n'),
          },
        ],
        schemaName: 'comms_report',
        schema: CommsReport,
        seed: seedFor('report'),
        budgetCapUsd: cap,
        maxTokens: 16_000,
        promptTemplate: 'insight.comms_report',
        promptVersion: INSIGHT_PROMPT_VERSION,
      });
      spend += r.costUsd;
      if (!r.ok || !r.value) throw new InsightFailed(`The strategist's report could not be produced (${r.outcome}).`);
      const cite = citeFilter(valid);
      content = {
        ...r.value,
        audienceInsights: r.value.audienceInsights.map((a) => ({ ...a, evidenceIds: cite(a.evidenceIds) })),
        basedOn: { panelQuestionId: panel?.id ?? null, personas: l.personas.length },
      };
    } else if (artifact.kind === 'SELF_INTRO' || artifact.kind === 'INTERVIEW') {
      const p = l.personas.find((x) => x.key === artifact.agentKey);
      if (!p) throw new InsightFailed('That persona is not part of this debate.');
      const cite = citeFilter(new Set(l.items.map((e) => e.id)));
      const base = { agentKey: p.key, name: p.name, segment: p.segment ?? null, market: marketOf(p.segment) };
      if (artifact.kind === 'SELF_INTRO') {
        const r = await callModel({
          debateId: l.debate.id,
          stage: 'INSIGHT_SELF_INTRO',
          personaKey: p.key,
          system: personaSystem(p, l),
          messages: [
            {
              role: 'user',
              content: [
                'Introduce yourself to a market strategist in a short self-introduction report: who you are, your everyday',
                'life and priorities as your segment, what you value in brands, your view on the focus group topic, and the',
                'channels through which a new brand could reach you. First person, plain and specific.',
                '',
                `Respond with JSON: ${SHAPE.intro}`,
              ].join('\n'),
            },
          ],
          schemaName: 'self_intro',
          schema: SelfIntro,
          seed: seedFor(p.key),
          budgetCapUsd: cap,
          promptTemplate: 'insight.self_intro',
          promptVersion: INSIGHT_PROMPT_VERSION,
        });
        spend += r.costUsd;
        if (!r.ok || !r.value) throw new InsightFailed(`The self-introduction could not be produced (${r.outcome}).`);
        content = { ...base, ...r.value, evidenceIds: cite(r.value.evidenceIds) };
      } else {
        // The conversation so far with this persona, oldest first, so it remembers what it said.
        const earlier = await prisma.debateArtifact.findMany({
          where: { debateId: l.debate.id, kind: 'INTERVIEW', agentKey: p.key, status: 'COMPLETED', createdAt: { lt: artifact.createdAt } },
          orderBy: { createdAt: 'asc' },
          take: 12,
        });
        const history = earlier.flatMap((e) => [
          { role: 'user' as const, content: wrapUntrusted('strategist question', e.prompt ?? '') },
          { role: 'assistant' as const, content: JSON.stringify({ answer: (e.content as { answer?: string } | null)?.answer ?? '' }) },
        ]);
        const r = await callModel({
          debateId: l.debate.id,
          stage: 'INSIGHT_INTERVIEW',
          personaKey: p.key,
          system: personaSystem(p, l),
          messages: [
            ...history,
            {
              role: 'user',
              content: [
                'A market strategist is interviewing you about how a brand should enter your market. Their question:',
                wrapUntrusted('strategist question', artifact.prompt ?? ''),
                '',
                'Answer as yourself, in the first person. Set "outsideEvidence" to true if your answer goes beyond the evidence.',
                `Respond with JSON: ${SHAPE.interview}`,
              ].join('\n'),
            },
          ],
          schemaName: 'interview_answer',
          schema: InterviewAnswer,
          seed: seedFor(p.key, String(earlier.length)),
          budgetCapUsd: cap,
          promptTemplate: 'insight.interview',
          promptVersion: INSIGHT_PROMPT_VERSION,
        });
        spend += r.costUsd;
        if (!r.ok || !r.value) throw new InsightFailed(`The persona could not answer (${r.outcome}).`);
        content = { ...base, ...r.value, evidenceIds: cite(r.value.evidenceIds) };
      }
    } else {
      throw new InsightFailed(`Unknown artifact kind ${artifact.kind}.`);
    }

    await prisma.debateArtifact.update({
      where: { id: artifactId },
      data: { status: 'COMPLETED', content: content as object, evidence: (evidence ?? undefined) as object | undefined, spendUsd: spend, completedAt: new Date() },
    });
    return { artifactId, status: 'COMPLETED' };
  } catch (e) {
    const reason = e instanceof InsightFailed ? e.message : describeFailure(e).replace('The debate stopped', 'This stopped');
    if (!(e instanceof InsightFailed)) console.error('[insight] unexpected failure', e);
    const used = (await debateSpendUsd(artifact.debateId)) - startSpend;
    await prisma.debateArtifact.update({
      where: { id: artifactId },
      data: { status: 'FAILED', failureReason: reason.slice(0, 1000), spendUsd: Math.max(spend, used), completedAt: new Date() },
    });
    await recordAudit({ action: 'debate.insight_failed', targetType: 'debateArtifact', targetId: artifactId, projectId: artifact.projectId, actorUserId: artifact.createdById, reason: reason.slice(0, 300) });
    return { artifactId, status: 'FAILED', reason };
  }
}

class InsightFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsightFailed';
  }
}

// ── Report as Markdown (for download) ─────────────────────────────────────────

export function reportMarkdown(r: CommsReport & { basedOn?: { personas: number } }, meta: { topic: string; createdAt: Date; isMock: boolean }): string {
  const lines: string[] = [];
  const h = (t: string) => lines.push('', `## ${t}`, '');
  lines.push(`# ${r.title}`, '', `_Based on a simulated agent-swarm focus group on: "${meta.topic}". Generated ${meta.createdAt.toISOString().slice(0, 10)}.${meta.isMock ? ' Produced by the mock provider — placeholder text only.' : ''}_`);
  h('Executive summary');
  lines.push(r.executiveSummary);
  if (r.situation) (h('Situation'), lines.push(r.situation));
  if (r.objectives.length) (h('Objectives'), r.objectives.forEach((o) => lines.push(`- ${o}`)));
  if (r.audienceInsights.length) {
    h('Audience insights');
    r.audienceInsights.forEach((a) => lines.push(`- **${a.segment}** — ${a.insight} _Implication:_ ${a.implication}${a.evidenceIds.length ? ` (${a.evidenceIds.join(', ')})` : ''}`));
  }
  if (r.positioning) (h('Positioning'), lines.push(r.positioning));
  if (r.keyMessages.length) {
    h('Key messages');
    r.keyMessages.forEach((m) => {
      lines.push(`- **${m.message}** (${m.audience})`);
      m.proofPoints.forEach((p) => lines.push(`  - ${p}`));
    });
  }
  if (r.channels.length) (h('Channels'), r.channels.forEach((c) => lines.push(`- **${c.channel}** — ${c.role} ${c.rationale}`)));
  if (r.voices.length) (h('Voices and spokespeople'), r.voices.forEach((v) => lines.push(`- **${v.voice}** — ${v.why}`)));
  if (r.phasedPlan.length) {
    h('Phased plan');
    r.phasedPlan.forEach((p) => {
      lines.push(`### ${p.phase} (${p.timing})`, '', p.objective, '');
      p.activities.forEach((a) => lines.push(`- ${a}`));
      lines.push('');
    });
  }
  if (r.risks.length) (h('Risks and issues'), r.risks.forEach((x) => lines.push(`- **${x.risk}** (${x.likelihood}) — ${x.mitigation}`)));
  if (r.kpis.length) (h('Measures of success'), r.kpis.forEach((k) => lines.push(`- **${k.kpi}** — target: ${k.target}; measured by: ${k.measurement}`)));
  h('Limitations');
  lines.push('- The focus group was a simulation: persona agents built from published survey segments, not real respondents. Test these recommendations in market.');
  r.limitations.forEach((x) => lines.push(`- ${x}`));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
