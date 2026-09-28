/**
 * Runs the persona adherence contrast test against the configured model (server only).
 * Only for cohorts built from a population sample: they carry segment-level observed answers, so
 * there is something for a persona to adhere to. Mock provider → not evaluated, never "pass".
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { modelProvider, extractJson } from '@/model/client';
import { buildEvidenceContext } from '@/model/context';
import { deriveSeed } from '@/model/provider';
import { personaSystem, type PersonaForRun } from '@/run/orchestrator';
import type { BriefModelContext } from '@/server/brief';
import { chooseContrast, scoreContrast, type AdherenceOutcome, type ProbeAnswer } from './adherence';

const Probe = z.object({ answer: z.enum(['agree', 'disagree', 'neither']), reason: z.string().max(1000).optional() });

const PROBE_BRIEF: BriefModelContext = {
  researchQuestion: 'Adherence check', objective: '', decisionSupported: '', targetAudience: null, markets: [], timePeriod: null,
  competitors: [], constraints: null, exclusions: [], prohibitedInferences: [], hypotheses: [],
} as unknown as BriefModelContext;

export async function runAdherenceCheck(user: SessionUser, projectId: string, cohortId: string): Promise<AdherenceOutcome & { costUsd: number; model: string }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'persona.create', projectId)) throw new AuthorizationError('persona.create', projectId);
  const cohort = await prisma.cohort.findFirst({ where: { id: cohortId, projectId } });
  if (!cohort) throw new AuthorizationError('persona.create', projectId);

  const provider = modelProvider();
  const record = async (o: AdherenceOutcome, costUsd: number) => {
    await prisma.judgeCheck.create({
      data: {
        projectId, kind: 'persona_adherence', targetType: 'cohort', targetId: cohortId, provider: provider.name, model: provider.modelId,
        verdict: o.status, flagged: o.status === 'fail', detail: { ...o, costUsd } as object,
      },
    });
    return { ...o, costUsd, model: provider.modelId };
  };
  const empty = { statement: null, withTrait: [], withoutTrait: [], threshold: 0.8 };

  if (!cohort.populationSampleId) {
    return record({ ...empty, status: 'not_applicable', reason: 'Only cohorts built from a population sample carry segment-level answers to test adherence against.' }, 0);
  }
  const sample = await prisma.populationSample.findUnique({ where: { id: cohort.populationSampleId } });
  if (!sample) return record({ ...empty, status: 'not_applicable', reason: 'The population sample behind this cohort no longer exists.' }, 0);
  // Persona attributes go to the model provider: the source must still permit model processing.
  await buildEvidenceContext(sample.datasetVersionId);

  const rows = await prisma.persona.findMany({
    where: { cohortId },
    include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, include: { attributes: true } } },
    orderBy: { name: 'asc' },
  });
  const personas: PersonaForRun[] = rows.filter((p) => p.versions[0]).map((p) => {
    const v = p.versions[0]!;
    return {
      id: p.id, versionId: v.id, key: p.name, name: p.name, summary: v.summary ?? p.name, segment: v.segment, coverageNote: v.coverageNote,
      confidence: v.confidence, baseSize: v.baseSize,
      attributes: v.attributes.map((a) => ({ label: a.label, value: a.value, origin: a.origin, baseSize: a.baseSize })),
    };
  });
  // Primary segment only: contrast is about the observed answers, which are per primary segment.
  const plan = chooseContrast(personas.map((p) => ({ key: p.key, segment: (p.segment ?? p.key).split(' × ')[0]!, attributes: p.attributes })));
  if (!plan) return record({ ...empty, status: 'not_applicable', reason: 'No tracked statement splits the segments\' majorities, so there is no contrast to test.' }, 0);
  if (provider.name === 'mock') {
    return record({ ...scoreContrast(plan, {}), status: 'not_evaluated', reason: 'The mock provider does not read persona attributes, so adherence cannot be evaluated. Configure the live model and run again.' }, 0);
  }

  const answers: Record<string, ProbeAnswer | null> = {};
  let costUsd = 0;
  for (const side of [plan.withTrait, plan.withoutTrait]) {
    for (const { key } of side) {
      const persona = personas.find((p) => p.key === key)!;
      // The statement's distribution stays in the profile, as the MatrAIx test injects the trait.
      // Withholding it would reward the model for guessing from age stereotypes, which is the
      // opposite of adherence. What this catches is drift: a persona agreeing (or hedging)
      // against its own segment's published majority.
      const probed = persona;
      const res = await provider.complete({
        stage: 'ADHERENCE_PROBE',
        personaKey: key,
        system: personaSystem(probed, '', PROBE_BRIEF),
        messages: [{ role: 'user', content: `As the segment you represent, do you agree with this statement?\n"${plan.statement}"\nRespond with JSON: { "answer": "agree" | "disagree" | "neither", "reason": string }` }],
        schemaName: 'adherence_probe',
        seed: deriveSeed(sample.seed, 'adherence', key),
      });
      costUsd += res.costUsd;
      try {
        answers[key] = res.outcome === 'ok' ? Probe.parse(extractJson(res.text)).answer : null;
      } catch {
        answers[key] = null;
      }
    }
  }
  return record(scoreContrast(plan, answers), Math.round(costUsd * 10000) / 10000);
}

export async function latestAdherence(cohortIds: readonly string[]) {
  if (cohortIds.length === 0) return new Map<string, { verdict: string; detail: AdherenceOutcome; createdAt: Date; model: string }>();
  const rows = await prisma.judgeCheck.findMany({ where: { kind: 'persona_adherence', targetId: { in: [...cohortIds] } }, orderBy: { createdAt: 'desc' } });
  const m = new Map<string, { verdict: string; detail: AdherenceOutcome; createdAt: Date; model: string }>();
  for (const r of rows) if (!m.has(r.targetId)) m.set(r.targetId, { verdict: r.verdict, detail: r.detail as unknown as AdherenceOutcome, createdAt: r.createdAt, model: r.model });
  return m;
}
