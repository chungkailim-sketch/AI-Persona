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
  const said = new Map(
    (await prisma.simulatedResponse.findMany({ where: { runId, responseType: 'assessment' } })).map((a) => [a.personaKey, a]),
  );
  for (const r of rows) {
    r.dissenting = r.final !== null && r.final !== majority;
    const a = said.get(r.persona);
    const conf = (a?.scores as { confidence?: number; evidenceCited?: string[] } | null) ?? null;
    const vote2 = votes.find((x) => x.personaKey === r.persona && x.round === 2);
    const cited = conf?.evidenceCited?.length ?? 0;
    const parts = [
      `Alone, it answered ${r.independent}${typeof conf?.confidence === 'number' ? ` at confidence ${conf.confidence.toFixed(2)}` : ''}` +
        `${cited ? `, citing ${cited} evidence field(s)` : ', citing no evidence field'}.`,
      a && !a.content.startsWith('[MOCK]') ? `Its reasoning: "${a.content.slice(0, 200)}${a.content.length > 200 ? '…' : ''}"` : '',
      r.moved
        ? `After ${majority && r.independent === majority ? 'challengers argued against the majority it belonged to' : 'hearing the challenges'}, it moved to ${r.final}${vote2?.challenge && !vote2.challenge.startsWith('[MOCK]') ? `: "${vote2.challenge.slice(0, 160)}${vote2.challenge.length > 160 ? '…' : ''}"` : '.'}`
        : `It held ${r.final} through the challenge round${r.dissenting ? ', against the majority' : ''}.`,
      (r.baseSize ?? 0) < 30 ? 'Small base — illustrative only.' : `Base ${r.baseSize}, weight ${Math.round(r.weight * 1000) / 10}% of the sample.`,
    ];
    r.explanation = parts.filter(Boolean).join(' ');
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


// ── Findings detail: the numbers behind "What the run found" ────────────────

/** Wilson score interval for a share, in percent. Honest at small n, where the normal one is not. */
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number } | null {
  if (n <= 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.round(Math.max(0, centre - half) * 1000) / 10, high: Math.round(Math.min(1, centre + half) * 1000) / 10 };
}

type Stance = 'confirm' | 'dispute' | 'abstain';

export interface FindingsDetail {
  panel: number;
  support: { confirm: number; dispute: number; abstain: number; pct: number | null; ci: { low: number; high: number } | null };
  independentSupportPct: number | null;
  meanConfidence: { independent: number | null; final: number | null };
  byMarket: { market: string; n: number; confirm: number; dispute: number; abstain: number; pct: number }[];
  bySegment: { segment: string; n: number; confirm: number; pct: number }[];
  reactions: { positive: number; mixed: number; negative: number; meanIntensity: number | null; drivers: { text: string; count: number }[]; barriers: { text: string; count: number }[] };
  quotes: { persona: string; segment: string; stance: string; confidence: number | null; text: string }[];
  evidenceCited: { field: string; count: number }[];
}

function top(items: string[], n: number): { text: string; count: number }[] {
  const m = new Map<string, number>();
  for (const i of items) {
    const k = i.trim();
    if (k && !k.startsWith('[MOCK]')) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([text, count]) => ({ text, count }));
}

export async function findingsDetail(runId: string, findingId: string | null, rows: ResultsSummary['rows']): Promise<FindingsDetail> {
  const [responses, votes] = await Promise.all([
    prisma.simulatedResponse.findMany({ where: { runId } }),
    findingId ? prisma.personaVote.findMany({ where: { findingId } }) : Promise.resolve([]),
  ]);
  const count = (xs: (string | null)[], s: Stance) => xs.filter((x) => x === s).length;
  const finals = rows.map((r) => r.final);
  const n = rows.length;
  const confirm = count(finals, 'confirm');
  const independentConfirm = count(rows.map((r) => r.independent), 'confirm');

  const assessments = responses.filter((r) => r.responseType === 'assessment');
  const reactions = responses.filter((r) => r.responseType === 'reaction');
  const conf = (r: (typeof responses)[number]) => ((r.scores as { confidence?: number } | null)?.confidence ?? null);
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

  // Market and segment come from the persona's segment label ("China · 25-34") when it has one.
  const split = (seg: string) => (seg.includes(' · ') ? { market: seg.split(' · ')[0]!, segment: seg.split(' · ').slice(1).join(' · ') } : { market: '—', segment: seg });
  const groupBy = <K extends string>(key: (r: ResultsSummary['rows'][number]) => K) => {
    const m = new Map<K, ResultsSummary['rows']>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const byMarket = [...groupBy((r) => split(r.segment).market)].map(([market, rs]) => {
    const f = rs.map((r) => r.final);
    const c = count(f, 'confirm');
    return { market, n: rs.length, confirm: c, dispute: count(f, 'dispute'), abstain: count(f, 'abstain'), pct: Math.round((c / rs.length) * 100) };
  }).sort((a, b) => b.pct - a.pct);
  const bySegment = [...groupBy((r) => split(r.segment).segment)]
    .map(([segment, rs]) => {
      const c = count(rs.map((r) => r.final), 'confirm');
      return { segment, n: rs.length, confirm: c, pct: Math.round((c / rs.length) * 100) };
    })
    .filter((s) => s.n > 1 || byMarket.length === 1)
    .sort((a, b) => b.pct - a.pct);

  const rs = reactions.map((r) => r.scores as { intensity?: number; drivers?: string[]; barriers?: string[] } | null);
  const segmentOf = new Map(rows.map((r) => [r.persona, r.segment]));
  const finalOf = new Map(rows.map((r) => [r.persona, r.final]));
  const quote = (want: Stance) =>
    assessments
      .filter((a) => finalOf.get(a.personaKey) === want && !a.content.startsWith('[MOCK]'))
      .sort((a, b) => (conf(b) ?? 0) - (conf(a) ?? 0))
      .slice(0, 2)
      .map((a) => ({ persona: a.personaKey, segment: segmentOf.get(a.personaKey) ?? a.personaKey, stance: want, confidence: conf(a), text: a.content.slice(0, 420) }));
  const mockQuotes = assessments.slice(0, 2).map((a) => ({ persona: a.personaKey, segment: segmentOf.get(a.personaKey) ?? a.personaKey, stance: a.sentiment ?? '', confidence: conf(a), text: a.content.slice(0, 420) }));
  const quotes = [...quote('confirm'), ...quote('dispute')];

  return {
    panel: n,
    support: { confirm, dispute: count(finals, 'dispute'), abstain: count(finals, 'abstain'), pct: n ? Math.round((confirm / n) * 100) : null, ci: wilson(confirm, n) },
    independentSupportPct: n ? Math.round((independentConfirm / n) * 100) : null,
    meanConfidence: { independent: mean(assessments.map(conf).filter((x): x is number => x !== null)), final: null },
    byMarket,
    bySegment,
    reactions: {
      positive: reactions.filter((r) => r.sentiment === 'positive').length,
      mixed: reactions.filter((r) => r.sentiment === 'mixed').length,
      negative: reactions.filter((r) => r.sentiment === 'negative').length,
      meanIntensity: mean(rs.map((r) => r?.intensity).filter((x): x is number => typeof x === 'number')),
      drivers: top(rs.flatMap((r) => r?.drivers ?? []), 5),
      barriers: top(rs.flatMap((r) => r?.barriers ?? []), 5),
    },
    quotes: quotes.length ? quotes : mockQuotes,
    evidenceCited: top(votes.filter((v) => v.round === 1).flatMap((v) => (v.citedEvidence ?? '').split(';')), 6).map((x) => ({ field: x.text, count: x.count })),
  };
}
