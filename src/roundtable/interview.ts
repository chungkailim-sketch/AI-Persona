/**
 * Interviewing one persona (server only). The persona answers in the first person from its
 * published statistics, its illustrative identity, what it said in the roundtable, and the earlier
 * questions in this conversation. A reply that goes beyond the data says so.
 */
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { callModel, ownerSpendUsd } from '@/model/client';
import { deriveSeed } from '@/model/provider';
import { wrapUntrusted } from '@/model/context';
import { JourneyRefused } from './service';
import { segmentLine, type CastProfile, type Lang, type ScoredCategory } from './engine';
import { PersonaReply } from './schemas';

const HISTORY = 6;

export async function loadCastPersona(projectId: string, personaId: string) {
  return prisma.persona.findFirst({
    where: { id: personaId, cohort: { projectId, kind: 'cast' } },
    include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 }, cohort: { select: { id: true, name: true } } },
  });
}

export async function personaChats(projectId: string, personaId: string) {
  return prisma.personaChat.findMany({ where: { projectId, personaId }, orderBy: { createdAt: 'asc' }, take: 100 });
}

export async function askPersona(user: SessionUser, projectId: string, personaId: string, question: string, lang: Lang) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'simulation.run', projectId)) throw new AuthorizationError('simulation.run', projectId);
  const q = question.trim();
  if (q.length < 4) throw new JourneyRefused(['Enter a question.']);
  if (q.length > 1500) throw new JourneyRefused(['Keep the question under 1,500 characters.']);
  const persona = await loadCastPersona(projectId, personaId);
  const profile = persona?.versions[0]?.profile as unknown as CastProfile | null;
  if (!persona || !profile) throw new JourneyRefused(['That persona is not part of this project.']);

  const [history, said] = await Promise.all([
    prisma.personaChat.findMany({ where: { projectId, personaId, ok: true }, orderBy: { createdAt: 'desc' }, take: HISTORY }),
    prisma.roundtableAnswer.findFirst({ where: { personaId, ok: true }, orderBy: { createdAt: 'desc' }, include: { roundtable: { select: { question: true } } } }),
  ]);
  const id = profile.identity;
  const scores = ((said?.scores ?? []) as unknown as ScoredCategory[]).map((s) => `${s.category} ${s.score}`).join(', ');
  const r = await callModel({
    cohortId: persona.cohort!.id,
    stage: 'PERSONA_INTERVIEW',
    personaKey: persona.id.slice(-8),
    system: [
      `You are ${id ? `"${id.name}", ${id.age}, ${id.occupation} in ${id.city} (${id.lifeStage})` : `a consumer in ${profile.market}`} —`,
      `an illustrative persona standing for one segment of ${profile.market}: ${segmentLine(profile)}; base ${profile.base}.`,
      id ? `What drives your purchase decisions, in order: ${id.decisionLogic.join(' > ')}.` : '',
      'You are a simulation built from published survey statistics, interviewed by a market strategist. Answer in the',
      'first person, naturally and specifically, as a typical member of your segment — not as an assistant.',
      '',
      'Published statistics for your segment:',
      ...profile.stats.map((s) => `${s.id}: "${s.statement}" → ${s.response}: ${s.share}% vs ${s.overall}% of all adults (base ${s.base})`),
      `STAT IDS: ${profile.stats.map((s) => s.id).join(' | ')}`,
      said ? `\nIn the roundtable you were asked "${said.roundtable.question}" and said: "${said.quote ?? ''}" (openness by category: ${scores}).` : '',
      '',
      'Rules:',
      '1. Ground what you say in the statistics; list the ids you drew on. Never state a figure that is not given.',
      '2. When a question goes beyond them, answer as your segment plausibly would, set beyondData to true, and say so in a few words.',
      '3. Stay consistent with what you have said before.',
      `4. ${lang === 'zh' ? 'Answer in Simplified Chinese.' : 'Answer in English.'}`,
      '5. Reply with a single JSON object: { "answer": string, "beyondData": boolean, "statIds": string[] }. No prose outside it.',
    ].filter(Boolean).join('\n'),
    messages: [
      ...history.reverse().flatMap((h) => [
        { role: 'user' as const, content: h.question },
        { role: 'assistant' as const, content: JSON.stringify(h.answer) },
      ]),
      { role: 'user', content: wrapUntrusted('strategist question', q) },
    ],
    schemaName: 'persona_reply',
    schema: PersonaReply,
    seed: deriveSeed(1, 'interview', persona.id, String(history.length)),
    budgetCapUsd: (await ownerSpendUsd({ cohortId: persona.cohort!.id })) + env().AI_RUN_BUDGET_USD,
    promptTemplate: 'roundtable.persona_interview',
    promptVersion: '1.0.0',
  });
  const valid = new Set(profile.stats.map((s) => s.id));
  return prisma.personaChat.create({
    data: {
      projectId,
      personaId,
      question: q,
      ok: r.ok,
      answer: r.ok && r.value ? ({ ...r.value, statIds: r.value.statIds.map((x) => x.toUpperCase()).filter((x) => valid.has(x)), isMock: r.isMock } as object) : ({ error: r.outcome } as object),
      createdById: user.userId,
    },
  });
}
