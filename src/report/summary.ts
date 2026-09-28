/**
 * Summaries the results screen draws beside the assembled report. All derived from the tables of
 * record — `ModelCall`, `PersonaVote`, `PersonaVersion` — never from free text.
 */
import { weightedShare } from '@/population/core';
import { prisma } from '@/lib/prisma';
import type { AssembledReport } from '@/report/assemble';

export interface CallRow {
  stage: string;
  personaKey: string | null;
  attempt: number;
  outcome: string;
  schemaValid: boolean;
}

/**
 * Pass / flag / fail per answer (a stage × persona pair): pass when the first attempt was valid,
 * flag when only a repair attempt was, fail when no attempt was.
 */
export function verdictsFromCalls(calls: CallRow[]): { pass: number; flag: number; fail: number } {
  const byAnswer = new Map<string, CallRow[]>();
  for (const c of calls) {
    const k = `${c.stage}|${c.personaKey ?? ''}`;
    byAnswer.set(k, [...(byAnswer.get(k) ?? []), c]);
  }
  let pass = 0;
  let flag = 0;
  let fail = 0;
  for (const attempts of byAnswer.values()) {
    const ok = attempts.find((a) => a.outcome === 'ok' && a.schemaValid);
    if (!ok) fail += 1;
    else if (ok.attempt > 1) flag += 1;
    else pass += 1;
  }
  return { pass, flag, fail };
}

export interface SegmentComparisonRow {
  persona: string;
  segment: string;
  baseSize: number | null;
  /** The segment's share of the survey sample (PersonaVersion.weight). */
  weight: number;
  confidence: string;
  independent: string | null;
  final: string | null;
  moved: boolean;
  dissenting: boolean;
  explanation: string;
}

export async function resultsSummary(runId: string, findingId: string | null) {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { config: { select: { cohortId: true, stimulusIds: true } }, modelCalls: { select: { stage: true, personaKey: true, attempt: true, outcome: true, schemaValid: true } } },
  });
  const verdicts = verdictsFromCalls(run?.modelCalls ?? []);

  const personas = run?.config?.cohortId
    ? await prisma.persona.findMany({
        where: { cohortId: run.config.cohortId },
        include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { segment: true, baseSize: true, confidence: true, weight: true } } },
      })
    : [];
  const votes = findingId ? await prisma.personaVote.findMany({ where: { findingId }, orderBy: { round: 'asc' } }) : [];

  const finalCounts = new Map<string, number>();
  const rows: SegmentComparisonRow[] = personas
    .map((p) => {
      const v = p.versions[0];
      const r1 = votes.find((x) => x.personaKey === p.name && x.round === 1)?.vote ?? null;
      const r2 = votes.find((x) => x.personaKey === p.name && x.round === 2)?.vote ?? r1;
      if (r2) finalCounts.set(r2, (finalCounts.get(r2) ?? 0) + 1);
      return { p, v, r1, r2 };
    })
    .filter((x) => x.r1 !== null)
    .map(({ p, v, r1, r2 }) => ({
      persona: p.name,
      segment: v?.segment ?? p.name,
      baseSize: v?.baseSize ?? null,
      weight: v?.weight ?? 0,
      confidence: v?.confidence ?? 'LOW',
      independent: r1?.toLowerCase() ?? null,
      final: r2?.toLowerCase() ?? null,
      moved: Boolean(r1 && r2 && r1 !== r2),
      dissenting: false,
      explanation: '',
    }));
  const majority = [...finalCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.toLowerCase() ?? null;
  for (const r of rows) {
    r.dissenting = r.final !== null && r.final !== majority;
    r.explanation = r.moved
      ? `Changed from ${r.independent} to ${r.final} after the challenge round.`
      : `Held ${r.final} through the challenge round.`;
    if ((r.baseSize ?? 0) < 30) r.explanation += ' Small base — illustrative only.';
  }

  const tally = (round: 1 | 2) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const s = round === 1 ? r.independent : r.final;
      if (s) m.set(s, (m.get(s) ?? 0) + 1);
    }
    return ['confirm', 'dispute', 'abstain'].map((k) => ({ key: k, label: k, count: m.get(k) ?? 0 }));
  };

  // Weighted by each segment's share of the survey sample. That is the sample, not a census:
  // the label in the interface must say so. Null when the cohort carries no weights.
  const weightedSupport = weightedShare(rows.map((r) => ({ weight: r.weight, value: r.final })), 'confirm');
  const weightedIndependentSupport = weightedShare(rows.map((r) => ({ weight: r.weight, value: r.independent })), 'confirm');

  return {
    verdicts,
    rows,
    majority,
    weightedSupport,
    weightedIndependentSupport,
    independent: tally(1),
    final: tally(2),
    stimulusCount: run?.config?.stimulusIds.length ?? 0,
  };
}

export type ResultsSummary = Awaited<ReturnType<typeof resultsSummary>>;

/** Rule-based next steps: each is triggered by a stated condition in this run, and says which. */
export function nextExperiments(report: Pick<AssembledReport, 'findings' | 'isMock' | 'groupthinkWarning'>, summary: Pick<ResultsSummary, 'rows' | 'stimulusCount' | 'verdicts'>): string[] {
  const out: string[] = [];
  const f = report.findings[0];
  if (report.isMock) out.push('Re-run with a live model provider — this run used the mock provider and its outputs mean nothing.');
  if (f?.classification === 'CONTESTED' || f?.classification === 'MINORITY_RETAINED') out.push('The panel did not settle. Test the hypothesis with real respondents before acting on either side of it.');
  if (report.groupthinkWarning) out.push('Herding was detected. Re-run with a different seed and compare the independent round, which is the only one free of exposure.');
  if (summary.rows.some((r) => (r.baseSize ?? 0) < 30)) out.push('Some segments rest on small bases. Source a larger sample for those segments before drawing segment-level conclusions.');
  if (summary.stimulusCount < 2) out.push('To compare message variants, add a second stimulus and run an A/B comparison when that mode is available.');
  if (summary.verdicts.fail > 0) out.push(`${summary.verdicts.fail} answer(s) were unusable. Check the telemetry for the failed calls before relying on the panel size.`);
  if (out.length === 0) out.push('Treat the result as a hypothesis to test with real people; the report states the bar set before the run.');
  return out;
}

