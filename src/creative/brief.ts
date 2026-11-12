/**
 * The AIGC creative brief (server only; written on the worker).
 *
 * Combines the study brief, the project's communication preferences and creative treatment
 * (src/creative/prefs.ts) and the roundtable's key messaging — the communications headline, pillars
 * and market messages, the takeaways, and the hero persona — into the rows of the AI-Persona-to-AIGC
 * Creative Brief Template, ready for Runway or Figma Weave. Output specs that follow from the
 * preferences are set in code; the model writes the concept, direction and the per-shot prompts.
 * Prompts are written in English, which video models follow most reliably.
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
import { list, text } from '@/debate/insightSchemas';
import { JourneyRefused, latestBrief } from '@/roundtable/service';
import { loadReport } from '@/roundtable/report';
import { BRIEF_FIELDS, type CreativeBriefContent } from './fields';
import { readPrefs, shotCount, type CreativePrefs } from './prefs';

export const CREATIVE_PROMPT_VERSION = '1.0.0';
// Rows that follow directly from the preferences: set in code, not by the model.
const COMPUTED = new Set(['projectTitle', 'brand', 'owner', 'mode', 'deliverable', 'ratio', 'resolution', 'clipLength', 'runtime', 'frameRate', 'shots', 'settings', 'version']);
const MODEL_KEYS = BRIEF_FIELDS.filter((f) => !COMPUTED.has(f.key)).map((f) => f.key);

export async function requestCreativeBrief(user: SessionUser, projectId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'simulation.run', projectId)) throw new AuthorizationError('simulation.run', projectId);
  const brief = await latestBrief(projectId);
  if (!brief?.researchQuestion) throw new JourneyRefused(['Complete the Brief first: the creative brief starts from it.']);
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

function outputSpecs(p: CreativePrefs, projectName: string, owner: string, version: number): Record<string, string> {
  const shots = Math.min(12, shotCount(p));
  return {
    projectTitle: projectName,
    brand: p.brand,
    owner: p.owner || owner,
    mode: p.mode,
    deliverable: p.deliverable,
    ratio: (p.ratios.length ? p.ratios : ['16:9']).join(', '),
    resolution: p.resolution,
    clipLength: `${p.clipSeconds} seconds`,
    runtime: `${p.runtimeSeconds} seconds`,
    frameRate: `${p.frameRate} fps`,
    shots: `${shots} (${Math.ceil(p.runtimeSeconds / p.clipSeconds)} in the cut, plus spares)`,
    settings: `${p.mode}; ${p.clipSeconds}-second clips; ${shots} shots; 2–3 variations per shot; fix the seed when re-running a shot for consistency.`,
    version: `v${version}`,
  };
}

const ModelBrief = z.object({
  fields: z.preprocess((v) => (v && typeof v === 'object' ? v : {}), z.record(text(900))),
  shots: list(z.object({ title: text(80), prompt: text(900) }), 12).transform((a) => a.filter((s) => s.prompt)),
});

class BriefFailed extends Error {}

export async function executeCreativeBrief(adviceId: string): Promise<{ adviceId: string; status: string; reason?: string }> {
  const advice = await prisma.advice.findUnique({ where: { id: adviceId } });
  if (!advice) throw new Error(`Creative brief ${adviceId} does not exist.`);
  if (advice.status === 'COMPLETED') return { adviceId, status: 'COMPLETED' };
  await prisma.advice.update({ where: { id: adviceId }, data: { status: 'RUNNING', failureReason: null } });
  const opts = (advice.options ?? {}) as { version?: number; owner?: string };
  try {
    const [project, brief, report] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: advice.projectId }, select: { name: true, creative: true } }),
      latestBrief(advice.projectId),
      loadReport(advice.projectId),
    ]);
    const prefs = readPrefs(project.creative);
    const specs = outputSpecs(prefs, project.name, opts.owner ?? '', opts.version ?? 1);
    const nShots = Math.min(12, shotCount(prefs));

    // The hero: the persona chosen in the creative treatment, else the most open persona.
    const answered = (report?.cast ?? []).filter((p) => p.answer);
    const hero = answered.find((p) => p.id === prefs.heroPersonaId) ?? [...answered].sort((a, b) => (b.answer?.overall ?? 0) - (a.answer?.overall ?? 0))[0] ?? report?.cast[0];
    const id = hero?.profile.identity;
    const summary = report?.summary;
    const topMarkets = [...(report?.view.markets ?? [])].sort((a, b) => b.overall - a.overall).slice(0, 3);
    const lead = Object.entries(report?.view.categoryMeans ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);

    const basis = [
      `Roundtable question: ${report?.roundtable.question ?? brief?.researchQuestion ?? '—'}`,
      topMarkets.length ? `Most open markets (0–100): ${topMarkets.map((m) => `${m.market} ${Math.round(m.overall)}`).join(', ')}` : '',
      lead.length ? `Lead categories: ${lead.map(([c, v]) => `${c} ${Math.round(v)}`).join(', ')}` : '',
      summary?.comms?.headline ? `Communications headline: ${summary.comms.headline}` : '',
      ...(summary?.takeaways ?? []).slice(0, 3).map((t) => `Takeaway: ${t}`),
      hero && id ? `Hero persona (illustrative): ${hero.name}, ${id.age}, ${id.occupation}, ${id.city} — ${hero.profile.market}, ${hero.profile.tierLabel}` : '',
      report?.roundtable.isMock ? 'Note: the roundtable ran on the mock model; its words are placeholders.' : '',
    ].filter(Boolean);

    const wanted = MODEL_KEYS;
    const r = await callModel({
      adviceId,
      stage: 'CREATIVE_BRIEF',
      personaKey: 'creative-director',
      system: [
        'You are a creative director writing a brief for AI video generation (Runway or Figma Weave) from a consumer study.',
        'Fill each field of the brief concisely and concretely. Ground the audience, key message and casting in the study evidence given;',
        'follow the communication preferences and creative treatment; never contradict them.',
        '',
        'Rules:',
        '1. "keyMessage" is the single takeaway, built from the communications headline and pillars.',
        '2. "subject", "subjectDetails" and "anchors" describe an invented person matching the hero persona (age, occupation, life stage, market); never a real person or celebrity.',
        '3. "anchors": 3 to 5 visual traits, written exactly as they must be repeated in every prompt. "styleRule": 2 to 3 style words, likewise.',
        `4. Write ${nShots} shot prompts. Each follows: [Shot type + camera movement]: [Subject with consistency anchors] [one action] in [environment], [time of day]. [Lighting]. [Style, film look, palette].`,
        '   Plain positive language: describe what should appear, never what should not. One camera move and one action per shot. For image to video, describe only the motion.',
        '5. "mustNot" lists unwanted elements; "positive" rewrites each as what is wanted instead.',
        '6. No on-screen text in the prompts; the brand, legal lines and call to action are added in editing.',
        '7. Write every value in English, the language video models follow best.',
        '8. Reply with a single JSON object in the shape given. No prose outside it.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            `PROJECT: ${project.name}`,
            brief?.businessContext ? wrapUntrusted('brand and category context', brief.businessContext) : '',
            `OBJECTIVE: ${prefs.objective || brief?.objective || '—'}`,
            `TARGET AUDIENCE (brief): ${brief?.targetAudience ?? '—'}`,
            '',
            '## Communication preference',
            `Platforms: ${prefs.platforms.join(', ') || '—'} · Aspect ratios: ${specs.ratio} · Tone: ${prefs.tones.join(', ') || '—'} · Languages: ${prefs.languages || '—'}`,
            `Call to action: ${prefs.cta || '—'} · Mandatories: ${prefs.mandatories || '—'} · No-gos: ${prefs.noGos || '—'}`,
            '',
            '## Creative treatment',
            `Mode: ${prefs.mode} · Deliverable: ${prefs.deliverable} · Style: ${prefs.style} · Pacing: ${prefs.pacing}`,
            `Mood: ${prefs.mood || '—'} · Lighting: ${prefs.lighting || '—'} · Palette: ${prefs.palette || '—'} · Film look: ${prefs.filmLook || '—'}`,
            `References: ${prefs.references || '—'}`,
            `Runtime ${prefs.runtimeSeconds}s in ${prefs.clipSeconds}s clips; ${nShots} shots.`,
            '',
            '## Study evidence (simulated consumer roundtable)',
            ...basis.map((b) => `- ${b}`),
            ...(summary?.comms?.pillars ?? []).map((p) => `- Pillar: ${p.title} — ${p.detail}`),
            ...(summary?.comms?.byMarket ?? []).map((m) => `- ${m.market}: ${m.message}`),
            hero?.answer?.quote ? `- Hero persona quote: “${hero.answer.quote}”` : '',
            '',
            `FIELDS: ${wanted.join(' | ')}`,
            `Respond with JSON: { "fields": { ${wanted.map((k) => `"${k}": string`).join(', ')} }, "shots": [{ "title": string, "prompt": string }] }`,
          ].filter(Boolean).join('\n'),
        },
      ],
      schemaName: 'creative_brief',
      schema: ModelBrief,
      seed: deriveSeed(1, 'creative_brief', adviceId),
      budgetCapUsd: env().AI_RUN_BUDGET_USD,
      maxTokens: 8000,
      promptTemplate: 'creative.brief',
      promptVersion: CREATIVE_PROMPT_VERSION,
    });
    if (!r.ok || !r.value) throw new BriefFailed(`The creative brief could not be written (${r.outcome}). Try again.`);
    const fields: Record<string, string> = {};
    for (const f of BRIEF_FIELDS) fields[f.key] = COMPUTED.has(f.key) ? specs[f.key] ?? '' : (r.value.fields[f.key] ?? '').trim();
    const content: CreativeBriefContent = { fields, shots: r.value.shots.slice(0, nShots), basis };
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
