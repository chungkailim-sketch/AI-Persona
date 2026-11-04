/**
 * The PR, communications and marketing planner (server only; the plan is written on the worker).
 *
 * A plan answers one question from the team, drawing only on:
 *   - the study's data: each persona's published statistics (D-ids), the roundtable's computed
 *     openness by market and category, the market indices, and the latest debate verdict;
 *   - the curated knowledge bases (K-ids): PR/comms/marketing skills and market-entry knowledge.
 * Every insight cites the ids it rests on; ids that were not offered are dropped. What the data
 * cannot answer is listed as a data gap rather than filled in.
 */
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { enqueue } from '@/queue/queue';
import { callModel } from '@/model/client';
import { deriveSeed } from '@/model/provider';
import { wrapUntrusted } from '@/model/context';
import { knowledge, knowledgeContext, type KnowledgeEntry } from '@/knowledge/library';
import { latestBrief, latestCast, JourneyRefused } from '@/roundtable/service';
import { loadReport } from '@/roundtable/report';
import { segmentLine, type CastProfile, type Lang } from '@/roundtable/engine';
import { CommsPlan } from '@/roundtable/schemas';

export const PLANNER_PROMPT_VERSION = '1.0.0';

export async function requestPlan(user: SessionUser, projectId: string, input: { question: string; industry?: string; language: Lang }) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'simulation.run', projectId)) throw new AuthorizationError('simulation.run', projectId);
  const question = input.question.trim();
  if (question.length < 10) throw new JourneyRefused(['Ask the question in at least a sentence.']);
  if (question.length > 2000) throw new JourneyRefused(['Keep the question under 2,000 characters.']);
  const cast = await latestCast(projectId);
  if (!cast || cast.personas.length === 0) throw new JourneyRefused(['Build the personas first: the plan is grounded in their data.']);
  const advice = await prisma.advice.create({
    data: { projectId, kind: 'COMMS_PLAN', question, options: { industry: input.industry ?? 'All industries', language: input.language }, createdById: user.userId },
  });
  await enqueue({ kind: 'advice', input: { adviceId: advice.id }, idempotencyKey: `advice:${advice.id}`, maxAttempts: 1 });
  return { adviceId: advice.id };
}

export async function listPlans(projectId: string) {
  return prisma.advice.findMany({ where: { projectId, kind: 'COMMS_PLAN' }, orderBy: { createdAt: 'desc' }, take: 10 });
}

/** The study's data as numbered evidence lines. */
async function dataEvidence(projectId: string): Promise<{ lines: string[]; markets: string[] }> {
  const lines: string[] = [];
  const add = (s: string) => lines.push(`D${lines.length + 1}: ${s}`);
  const cast = await latestCast(projectId);
  for (const p of cast?.personas ?? []) {
    const pr = p.versions[0]?.profile as unknown as CastProfile | null;
    if (!pr) continue;
    for (const s of pr.stats.slice(0, 4)) add(`${pr.market}, ${segmentLine(pr)} (base ${s.base}): "${s.statement}" → ${s.response} ${s.share}% vs ${s.overall}% of all adults`);
  }
  const report = await loadReport(projectId);
  if (report) {
    add(`Roundtable question: ${report.roundtable.question}`);
    for (const m of report.view.markets) add(`${m.market}: mean openness ${Math.round(m.overall)}; by category ${Object.entries(m.categories).map(([c, v]) => `${c} ${Math.round(v)}`).join(', ')}`);
    for (const p of report.potential) if (p.score !== null) add(`Market potential index ${p.market}: ${p.score} (${p.tier}${p.missing.length ? `; missing ${p.missing.join(', ')}` : ''})`);
    for (const e of report.entry) if (e.score !== null) add(`Market entry index ${e.market}: ${e.score}, lead category ${e.lead ?? '—'}`);
    for (const p of report.cast.filter((x) => x.answer?.quote).slice(0, 20)) add(`${p.profile.market} ${p.profile.tierLabel} persona said: "${p.answer!.quote}" (barriers: ${p.answer!.barriers.slice(0, 2).join('; ')})`);
  }
  const debate = await prisma.debate.findFirst({ where: { projectId, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' } });
  const verdict = ((debate?.conclusion ?? {}) as { verdict?: { answer?: string; conclusion?: string } }).verdict;
  if (debate && verdict) add(`Agent-swarm debate on "${debate.topic}": ${verdict.answer} — ${String(verdict.conclusion ?? '').slice(0, 600)}`);
  const markets = [...new Set((cast?.personas ?? []).map((p) => (p.versions[0]?.profile as unknown as CastProfile | null)?.market).filter((m): m is string => Boolean(m)))];
  return { lines, markets };
}

export async function executePlan(adviceId: string): Promise<{ adviceId: string; status: string; reason?: string }> {
  const advice = await prisma.advice.findUnique({ where: { id: adviceId } });
  if (!advice) throw new Error(`Plan ${adviceId} does not exist.`);
  if (advice.status === 'COMPLETED') return { adviceId, status: 'COMPLETED' };
  await prisma.advice.update({ where: { id: adviceId }, data: { status: 'RUNNING', failureReason: null } });
  const opts = (advice.options ?? {}) as { industry?: string; language?: Lang };
  try {
    const [brief, data] = await Promise.all([latestBrief(advice.projectId), dataEvidence(advice.projectId)]);
    const entries: KnowledgeEntry[] = [...knowledge('COMMS_SKILLS', opts.industry), ...knowledge('MARKET_ENTRY', opts.industry)];
    const kb = knowledgeContext(entries);
    const r = await callModel({
      adviceId,
      stage: 'ADVICE_COMMS_PLAN',
      personaKey: 'strategist',
      system: [
        'You are a senior public relations, communications and marketing strategist at an agency, writing a plan that answers',
        'one question from the client team. Base it purely on the study data (D-ids: published consumer survey statistics, a',
        'simulated consumer roundtable and market indices computed from them) and on recognised frameworks (K-ids).',
        '',
        'Rules:',
        '1. Every audience insight cites the D-ids it rests on in "refs". Quote only figures that appear in the data.',
        '2. Use the frameworks that fit the question; in "frameworks", name each by its K-id and say how it was applied.',
        '3. Where the data cannot answer something the question needs, list it under "dataGaps" — do not invent it.',
        '4. The roundtable is simulated: treat it as a hypothesis to test, and say so where it matters.',
        '5. Be specific: name markets, audiences, channels, messages and phases. Channel "type" is paid, earned, shared or owned.',
        `6. ${opts.language === 'zh' ? 'Write every text value in Simplified Chinese.' : 'Write every text value in English.'}`,
        '7. Reply with a single JSON object in the shape you are given. No prose outside it.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: [
            wrapUntrusted('client question', advice.question),
            brief?.businessContext ? wrapUntrusted('brand and category context', brief.businessContext) : '',
            opts.industry && opts.industry !== 'All industries' ? `Industry: ${opts.industry}` : '',
            `MARKETS: ${data.markets.join(' | ')}`,
            '',
            '## Study data',
            data.lines.length ? data.lines.join('\n') : '(no data — say so in dataGaps)',
            `DATA IDS: ${data.lines.map((_, i) => `D${i + 1}`).slice(0, 40).join(' | ')}`,
            '',
            '## Frameworks and knowledge',
            kb.text,
            `KNOWLEDGE IDS: ${[...kb.ids.keys()].join(' | ')}`,
            '',
            'Respond with JSON: { "title": string, "answer": string, "situation": string, "objectives": string[], ' +
              '"audienceInsights": [{ "audience": string, "insight": string, "refs": string[] }], "positioning": string, ' +
              '"keyMessages": [{ "message": string, "audience": string, "proofPoints": string[] }], "channels": [{ "type": "paid" | "earned" | "shared" | "owned", "channel": string, "role": string }], ' +
              '"phasedPlan": [{ "phase": string, "timing": string, "activities": string[] }], "kpis": [{ "kpi": string, "target": string, "measurement": string }], ' +
              '"risks": [{ "risk": string, "mitigation": string }], "marketNotes": [{ "market": string, "note": string }], "frameworks": [{ "ref": string, "howApplied": string }], "dataGaps": string[] }',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      schemaName: 'comms_plan',
      schema: CommsPlan,
      seed: deriveSeed(1, 'advice', adviceId),
      budgetCapUsd: env().AI_RUN_BUDGET_USD,
      maxTokens: 8000,
      promptTemplate: 'advice.comms_plan',
      promptVersion: PLANNER_PROMPT_VERSION,
    });
    if (!r.ok || !r.value) throw new PlanFailed(`The plan could not be written (${r.outcome}). Try again, or ask a narrower question.`);
    const validData = new Set(data.lines.map((_, i) => `D${i + 1}`));
    const content = {
      ...r.value,
      audienceInsights: r.value.audienceInsights.map((a) => ({ ...a, refs: a.refs.map((x) => x.toUpperCase()).filter((x) => validData.has(x)) })),
      frameworks: r.value.frameworks.filter((f) => kb.ids.has(f.ref.toUpperCase())).map((f) => ({ ...f, ref: f.ref.toUpperCase(), id: kb.ids.get(f.ref.toUpperCase()) })),
    };
    await prisma.advice.update({
      where: { id: adviceId },
      data: {
        status: 'COMPLETED',
        content: content as object,
        sources: { data: data.lines, knowledge: [...kb.ids.entries()].map(([ref, id]) => ({ ref, id })) } as object,
        isMock: r.isMock,
        spendUsd: r.costUsd,
        completedAt: new Date(),
      },
    });
    return { adviceId, status: 'COMPLETED' };
  } catch (e) {
    const reason = e instanceof PlanFailed ? e.message : e instanceof Error ? `The plan stopped: ${e.message}` : 'The plan stopped.';
    await prisma.advice.update({ where: { id: adviceId }, data: { status: 'FAILED', failureReason: reason.slice(0, 1000), completedAt: new Date() } });
    return { adviceId, status: 'FAILED', reason };
  }
}

class PlanFailed extends Error {}
