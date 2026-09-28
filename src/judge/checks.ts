/**
 * Where judge opinions meet the product's records (server only). Each function records what was
 * asked and answered in `JudgeCheck` and returns only what the caller is allowed to act on.
 */
import { prisma } from '@/lib/prisma';
import type { SensitivityVerdict } from '@/ingest/sensitivity';
import {
  judgeEnabled,
  judgeModel,
  judgeProvider,
  screenStimulus,
  sensitiveFieldOpinions,
  stanceConsistency,
  type StanceItem,
  type StanceJudgement,
} from './typesafe';

async function projectForVersion(datasetVersionId: string): Promise<string | null> {
  const link = await prisma.projectDataset.findFirst({
    where: { dataset: { versions: { some: { id: datasetVersionId } } } },
    select: { projectId: true },
  });
  return link?.projectId ?? null;
}

/**
 * Second opinion on fields the in-code floor did NOT flag. A judge flag tightens the default (the
 * field starts excluded, with the reason shown); a judge "NONE" never clears a floor flag.
 */
export async function secondOpinionOnFields(
  datasetVersionId: string,
  names: readonly string[],
  verdicts: readonly SensitivityVerdict[],
): Promise<{ verdicts: SensitivityVerdict[]; added: string[]; consulted: boolean }> {
  const out = [...verdicts];
  if (!judgeEnabled('sensitive')) return { verdicts: out, added: [], consulted: false };
  const unflagged = names.map((n, i) => ({ n, i })).filter(({ i }) => verdicts[i]!.sensitivity === 'NONE');
  const r = await sensitiveFieldOpinions(unflagged.map((u) => u.n));
  if (!r) return { verdicts: out, added: [], consulted: false };
  const added: string[] = [];
  const projectId = await projectForVersion(datasetVersionId);
  r.opinions.forEach((o, k) => {
    const idx = unflagged[k]!.i;
    if (o.choice === 'NONE') return;
    added.push(o.name);
    out[idx] = {
      sensitivity: o.choice,
      reason: `Flagged by the judge-model second opinion from the field name alone (${o.choice === 'PII' ? 'could identify a person' : 'special category'}; confidence ${o.confidence.toFixed(2)}). The in-code checks did not flag it. Review before including.`,
      signal: 'name',
    };
  });
  if (projectId) {
    await prisma.judgeCheck.createMany({
      data: r.opinions.map((o) => ({
        projectId,
        kind: 'sensitive_field',
        targetType: 'datasetVersion',
        targetId: `${datasetVersionId}:${o.name}`.slice(0, 190),
        provider: judgeProvider(),
        model: judgeModel(),
        verdict: o.choice,
        confidence: o.confidence,
        flagged: o.choice !== 'NONE',
        detail: { field: o.name, inputs: 'field name only' },
        latencyMs: Math.round(r.latencyMs / Math.max(1, r.opinions.length)),
      })),
    });
  }
  return { verdicts: out, added, consulted: true };
}

export async function screenStimulusRecord(projectId: string, stimulusId: string, text: string): Promise<{ flagged: boolean; pInjection: number } | null> {
  if (!judgeEnabled('stimulus')) return null;
  const r = await screenStimulus(text);
  if (!r) return null;
  await prisma.judgeCheck.create({
    data: {
      projectId,
      kind: 'stimulus_injection',
      targetType: 'stimulus',
      targetId: stimulusId,
      provider: judgeProvider(),
      model: judgeModel(),
      verdict: r.flagged ? 'possible_injection' : 'clean',
      confidence: r.pInjection,
      flagged: r.flagged,
      detail: { pInjection: r.pInjection, threshold: 0.5 },
      latencyMs: r.latencyMs,
    },
  });
  return { flagged: r.flagged, pInjection: r.pInjection };
}

export async function latestStimulusChecks(stimulusIds: readonly string[]) {
  if (stimulusIds.length === 0) return new Map<string, { flagged: boolean; confidence: number | null }>();
  const rows = await prisma.judgeCheck.findMany({
    where: { kind: 'stimulus_injection', targetType: 'stimulus', targetId: { in: [...stimulusIds] } },
    orderBy: { createdAt: 'desc' },
  });
  const m = new Map<string, { flagged: boolean; confidence: number | null }>();
  for (const r of rows) if (!m.has(r.targetId)) m.set(r.targetId, { flagged: r.flagged, confidence: r.confidence });
  return m;
}

/** Recorded per persona and round; returns the confident inconsistencies for the run's warnings. */
export async function checkStances(
  projectId: string,
  runId: string,
  claim: string,
  items: readonly (StanceItem & { round: 1 | 2 })[],
): Promise<StanceJudgement[] | null> {
  if (!judgeEnabled('stance')) return null;
  const r = await stanceConsistency(claim, items);
  if (!r) return null;
  await prisma.judgeCheck.createMany({
    data: r.judgements.map((j, i) => ({
      projectId,
      kind: 'stance_consistency',
      targetType: 'run',
      targetId: `${runId}:${j.key}:r${items[i]!.round}`.slice(0, 190),
      provider: judgeProvider(),
      model: judgeModel(),
      verdict: j.judged,
      confidence: j.confidence,
      flagged: j.inconsistent,
      detail: { stated: j.stated, judged: j.judged, round: items[i]!.round },
      latencyMs: Math.round(r.latencyMs / Math.max(1, r.judgements.length)),
    })),
  });
  return r.judgements.filter((j) => j.inconsistent);
}
