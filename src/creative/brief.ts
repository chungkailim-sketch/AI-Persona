/**
 * The AIGC creative brief (server only; written on the worker).
 *
 * Written entirely from the study — nothing is typed in for it: the brief, every persona (identity,
 * published statistics, roundtable answer, quote, how to reach them, what holds them back, comms
 * advice), the roundtable's computed openness by market and category, its consensus, takeaways and
 * communications recommendation, the market potential and entry indices of the report, the latest
 * PR/comms plan and debate verdict. The model fills every row of the AI-Persona-to-AIGC Creative
 * Brief Template from that evidence, inferring what the study does not state (and listing which rows
 * it inferred), and writes a ready prompt for every shot. Prompts are in English, which video models
 * follow most reliably.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { enqueue } from '@/queue/queue';
import { recordAudit } from '@/lib/audit';
import { callModel } from '@/model/client';
import { deriveSeed } from '@/model/provider';
import { wrapUntrusted } from '@/model/context';
import { list, strings, text } from '@/debate/insightSchemas';
import { JourneyRefused, latestBrief } from '@/roundtable/service';
import { loadReport } from '@/roundtable/report';
import { projectContext } from '@/server/projectContext';
import type { CommsPlan } from '@/roundtable/schemas';
import { BRIEF_FIELDS, type CreativeBriefContent } from './fields';

export const CREATIVE_PROMPT_VERSION = '2.0.0';
const MAX_SHOTS = 12;

// Rows set in code: the project's own name, who asked for it, and the version.
const FIXED = new Set(['projectTitle', 'owner', 'version']);
const MODEL_KEYS = BRIEF_FIELDS.filter((f) => !FIXED.has(f.key)).map((f) => f.key);

/** A sensible value for a row the model left empty, so no row of the template is blank. */
const FALLBACK: Record<string, string> = {
  mode: 'Text to video',
  deliverable: 'Multi-shot sequence',
  ratio: '9:16 for social; 16:9 for web and events',
  resolution: 'Native output first, then upscale only approved clips',
  clipLength: '10 seconds',
  runtime: '30 seconds',
  frameRate: '24 fps',
  pacing: 'Rhythmic',
  shotType: 'Medium shot',
  angle: 'Eye level',
  lens: '50mm, shallow depth of field',
  cameraMove: 'Slow push-in',
  speed: 'Natural',
  intensity: 'Subtle',
  style: 'Cinematic live-action',
  composition: 'Rule of thirds, with negative space for text overlay',
  mustNot: 'On-screen text, logos, extra people, distorted hands or faces',
  positive: 'Clean, unmarked surfaces; a single person in frame; natural, well-formed hands and faces',
  settings: '2–3 variations per shot; fix the seed when re-running a shot for consistency',
};

export async function requestCreativeBrief(user: SessionUser, projectId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'simulation.run', projectId)) throw new AuthorizationError('simulation.run', projectId);
  const [brief, roundtable] = await Promise.all([
    latestBrief(projectId),
    prisma.roundtable.findFirst({ where: { projectId, status: 'COMPLETED' }, select: { id: true } }),
  ]);
  if (!roundtable && !brief?.researchQuestion) throw new JourneyRefused(['Run the roundtable first: the creative brief is written from its results.']);
  const busy = await prisma.advice.findFirst({ where: { projectId, kind: 'CREATIVE_BRIEF', status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } });
  if (busy) throw new JourneyRefused(['A creative brief is already being written. Wait for it to finish.']);
  const version = (await prisma.advice.count({ where: { projectId, kind: 'CREATIVE_BRIEF' } })) + 1;
  const advice = await prisma.advice.create({
    data: { projectId, kind: 'CREATIVE_BRIEF', question: `Creative brief v${version}`, options: { version, owner: user.displayName || user.email } as object, createdById: user.userId },
  });
  await enqueue({ kind: 'creative_brief', input: { adviceId: advice.id }, idempotencyKey: `creative_brief:${advice.id}`, maxAttempts: 1 });
  await recordAudit({ action: 'creative_brief.requested', targetType: 'project', targetId: projectId, projectId, actorUserId: user.userId, actorEmail: user.email, reason: `Creative brief v${version}` });
  return { adviceId: advice.id };
}

export async function listCreativeBriefs(projectId: string) {
  return prisma.advice.findMany({ where: { projectId, kind: 'CREATIVE_BRIEF' }, orderBy: { createdAt: 'desc' }, take: 10 });
}

const r0 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(Math.round(n)));

/** What the report adds beyond the project context: each persona's answer, the comms reading, the indices. */
async function reportEvidence(projectId: string): Promise<{ lines: string[]; basis: string[] }> {
  const report = await loadReport(projectId);
  if (!report) return { lines: [], basis: [] };
  const s = report.summary;
  const lines: string[] = ['## Personas in the roundtable (illustrative people standing for published segments)'];
  for (const p of report.cast) {
    const id = p.profile.identity;
    const a = p.answer;
    lines.push(
      `- ${p.name} — ${p.profile.market}, ${p.profile.tierLabel}${id ? `; ${id.age}, ${id.gender}, ${id.occupation}, ${id.city}; ${id.lifeStage}; decides on ${id.decisionLogic.join(' > ')}` : ''}` +
        (a ? `; openness ${r0(a.overall)}/100; says: “${a.quote}”` : ''),
    );
    if (a?.conditions.length) lines.push(`  - Would try if: ${a.conditions.join('; ')}`);
    if (a?.barriers.length) lines.push(`  - Barriers: ${a.barriers.join('; ')}`);
    if (a?.profile) {
      if (a.profile.howToReach.length) lines.push(`  - How to reach: ${a.profile.howToReach.join('; ')}`);
      if (a.profile.holdsBack.length) lines.push(`  - Holds back: ${a.profile.holdsBack.join('; ')}`);
      if (a.profile.commsAdvice.length) lines.push(`  - Comms advice: ${a.profile.commsAdvice.join('; ')}`);
      if (a.profile.mindset.length) lines.push(`  - Mindset: ${a.profile.mindset.map((m) => `${m.label} ${m.value}`).join(', ')}`);
    }
  }
  if (s?.comms) {
    lines.push('', '## Communications recommendation (report)', `Headline: ${s.comms.headline || '—'}`);
    for (const p of s.comms.pillars) lines.push(`- Pillar: ${p.title} — ${p.detail}`);
    for (const m of s.comms.byMarket) lines.push(`- ${m.market}: ${m.message}${m.channels.length ? ` (channels: ${m.channels.join(', ')})` : ''}`);
  }
  if (s?.marketReading) {
    const mr = s.marketReading;
    lines.push('', '## Market reading (report)', ...mr.potential.map((x) => `- Potential: ${x}`), ...mr.entry.map((x) => `- Entry: ${x}`), ...mr.strategy.map((x) => `- Strategy: ${x}`));
  }
  if (report.potential.length) lines.push('', `Market potential index (0–100): ${report.potential.map((p) => `${p.market} ${p.score ?? '—'} (${p.tier ?? '—'})`).join('; ')}`);
  if (report.entry.length) lines.push(`Market entry index: ${report.entry.map((e) => `${e.market} ${e.score ?? '—'}, lead category ${e.lead ?? '—'}`).join('; ')}`);

  const topMarkets = [...report.view.markets].sort((a, b) => b.overall - a.overall).slice(0, 3);
  const lead = Object.entries(report.view.categoryMeans).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const basis = [
    `Roundtable question: ${report.roundtable.question}`,
    topMarkets.length ? `Most open markets (0–100): ${topMarkets.map((m) => `${m.market} ${r0(m.overall)}`).join(', ')}` : '',
    lead.length ? `Lead categories: ${lead.map(([c, v]) => `${c} ${r0(v)}`).join(', ')}` : '',
    s?.comms?.headline ? `Communications headline: ${s.comms.headline}` : '',
    ...(s?.takeaways ?? []).slice(0, 3).map((t) => `Takeaway: ${t}`),
    report.roundtable.isMock ? 'Note: the roundtable ran on the mock model; its words are placeholders.' : '',
  ].filter(Boolean);
  return { lines, basis };
}

function planEvidence(plan: CommsPlan | null): string[] {
  if (!plan) return [];
  return [
    '## Latest PR, communications and marketing plan',
    plan.title ? `Title: ${plan.title}` : '',
    plan.positioning ? `Positioning: ${plan.positioning}` : '',
    ...plan.keyMessages.map((m) => `- Key message (${m.audience}): ${m.message}`),
    ...plan.channels.map((c) => `- Channel (${c.type}): ${c.channel} — ${c.role}`),
    ...plan.kpis.slice(0, 4).map((k) => `- KPI: ${k.kpi} — ${k.target}`),
  ].filter(Boolean);
}

const ModelBrief = z.object({
  fields: z.preprocess((v) => (v && typeof v === 'object' ? v : {}), z.record(text(900))),
  shots: list(z.object({ title: text(80), prompt: text(900) }), MAX_SHOTS).transform((a) => a.filter((s) => s.prompt)),
  inferred: strings(60, 40),
});

class BriefFailed extends Error {}

export async function executeCreativeBrief(adviceId: string): Promise<{ adviceId: string; status: string; reason?: string }> {
  const advice = await prisma.advice.findUnique({ where: { id: adviceId } });
  if (!advice) throw new Error(`Creative brief ${adviceId} does not exist.`);
  if (advice.status === 'COMPLETED') return { adviceId, status: 'COMPLETED' };
  await prisma.advice.update({ where: { id: adviceId }, data: { status: 'RUNNING', failureReason: null } });
  const opts = (advice.options ?? {}) as { version?: number; owner?: string };
  try {
    const [project, brief, context, report, planRow] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: advice.projectId }, select: { name: true } }),
      latestBrief(advice.projectId),
      projectContext(advice.projectId),
      reportEvidence(advice.projectId),
      prisma.advice.findFirst({ where: { projectId: advice.projectId, kind: 'COMMS_PLAN', status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const plan = (planRow?.content ?? null) as CommsPlan | null;

    const labels = BRIEF_FIELDS.filter((f) => MODEL_KEYS.includes(f.key)).map((f) => `- ${f.key} (${f.label}): ${f.hint}`);
    const r = await callModel({
      adviceId,
      stage: 'CREATIVE_BRIEF',
      personaKey: 'creative-director',
      system: [
        'You are a creative director at a communications agency. From a completed consumer study you write the complete brief',
        'for AI image and video generation (Runway, Figma Weave), in the agency\'s AIGC Creative Brief template.',
        'Nobody fills anything in for you: every row must be completed from the study evidence. Where the evidence does not',
        'state something (format, platform, runtime, camera, lighting, palette…), infer the choice that best fits the audience,',
        'markets, channels and key message, and list that row\'s key in "inferred".',
        '',
        'Rules:',
        '1. Fill every field. Be concrete and specific; no placeholders, no "TBD".',
        '2. "brand": the client and brand from the brief\'s context; if unnamed, describe it ("A Chinese skincare brand entering Southeast Asia").',
        '3. "objective", "audience" and "keyMessage" come from the roundtable: the most open markets and personas, the lead categories,',
        '   the communications headline and pillars, what would make the personas try the brand and what holds them back.',
        '4. "platform", "ratio", "runtime" and "deliverable" follow the channels the personas use (how to reach them, the plan\'s channels).',
        '5. "subject", "subjectDetails" and "anchors" describe an invented person modelled on the most relevant persona (age, occupation,',
        '   life stage, market); never a real person or a celebrity. "anchors": 3 to 5 visual traits written exactly as they must',
        '   be repeated in every prompt. "styleRule": 2 to 3 style words, likewise.',
        `6. Write as many shot prompts as the runtime needs (runtime / clip length, plus one spare), at most ${MAX_SHOTS}. Each follows:`,
        '   [Shot type + camera movement]: [Subject with consistency anchors] [one action] in [environment], [time of day]. [Lighting]. [Style, film look, palette].',
        '   Plain positive language: describe what should appear, never what should not. One camera move and one action per shot.',
        '   Let the shots carry the narrative beat and the key message, set in the lead market.',
        '7. "mustNot" lists unwanted elements; "positive" rewrites each as what is wanted instead. No on-screen text in the prompts.',
        '8. Treat the personas as simulated: their views are hypotheses from survey data, not facts.',
        '9. Write every value in English, the language video models follow best.',
        '10. Reply with a single JSON object in the shape given. No prose outside it.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `PROJECT: ${project.name}`,
            brief?.businessContext ? wrapUntrusted('brand and category context', brief.businessContext) : '',
            '',
            wrapUntrusted('study summary', context ?? ''),
            '',
            ...report.lines,
            '',
            ...planEvidence(plan),
            '',
            'Fields to fill:',
            ...labels,
            '',
            `FIELDS: ${MODEL_KEYS.join(' | ')}`,
            `Respond with JSON: { "fields": { ${MODEL_KEYS.map((k) => `"${k}": string`).join(', ')} }, "shots": [{ "title": string, "prompt": string }], "inferred": string[] }`,
          ].filter((x) => x !== undefined).join('\n'),
        },
      ],
      schemaName: 'creative_brief',
      schema: ModelBrief,
      seed: deriveSeed(1, 'creative_brief', adviceId),
      budgetCapUsd: env().AI_RUN_BUDGET_USD,
      maxTokens: 10000,
      promptTemplate: 'creative.brief',
      promptVersion: CREATIVE_PROMPT_VERSION,
    });
    if (!r.ok || !r.value) throw new BriefFailed(`The creative brief could not be written (${r.outcome}). Try again.`);

    const fixed: Record<string, string> = { projectTitle: project.name, owner: opts.owner ?? '', version: `v${opts.version ?? 1}` };
    const fields: Record<string, string> = {};
    const filledByDefault: string[] = [];
    for (const f of BRIEF_FIELDS) {
      const v = fixed[f.key] ?? (r.value.fields[f.key] ?? '').trim();
      if (v) fields[f.key] = v;
      else {
        fields[f.key] = FALLBACK[f.key] ?? '';
        if (FALLBACK[f.key]) filledByDefault.push(f.key);
      }
    }
    const inferredKeys = [...new Set([...r.value.inferred.filter((k) => MODEL_KEYS.includes(k)), ...filledByDefault])];
    const inferredLabels = BRIEF_FIELDS.filter((f) => inferredKeys.includes(f.key)).map((f) => f.label);
    const basis = [...report.basis, ...(inferredLabels.length ? [`Inferred where the study is silent (review these first): ${inferredLabels.join(', ')}`] : [])];
    const content: CreativeBriefContent = { fields, shots: r.value.shots.slice(0, MAX_SHOTS), basis };
    await prisma.advice.update({
      where: { id: adviceId },
      data: { status: 'COMPLETED', content: content as object, isMock: r.isMock, spendUsd: r.costUsd, completedAt: new Date() },
    });
    return { adviceId, status: 'COMPLETED' };
  } catch (e) {
    const reason = e instanceof BriefFailed || e instanceof JourneyRefused ? e.message : e instanceof Error ? `The creative brief stopped: ${e.message}` : 'The creative brief stopped.';
    await prisma.advice.update({ where: { id: adviceId }, data: { status: 'FAILED', failureReason: reason.slice(0, 1000), completedAt: new Date() } });
    return { adviceId, status: 'FAILED', reason };
  }
}
