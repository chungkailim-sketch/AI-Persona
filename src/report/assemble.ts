/**
 * Assembling a run's results for reading and export.
 *
 * One function builds the report, and both the screen and every export format render from it. That
 * is not tidiness — it is the only way the limitations block cannot be lost. A separate export path
 * is a path on which someone, at some point, drops the caveats to make the deck fit.
 *
 * Four things travel with every report and cannot be detached from it:
 *  - the standing statement that these results are simulated;
 *  - the anti-herding interpretation, beside the headline rather than in an appendix;
 *  - the evidence caveats carried up from ingestion;
 *  - the threshold each hypothesis set *before* the run, beside what the run actually found.
 *
 * The last one matters most. A reader who sees only the result cannot tell whether it met the bar
 * that was set, or whether the bar moved.
 */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { buildEvidenceContext } from '@/model/context';
import { collectEvidenceFigures } from '@/report/claimCheck';

export interface ReportVote {
  personaKey: string;
  independent: string | null;
  final: string | null;
  changed: boolean;
  challenge: string | null;
  citedEvidence: string | null;
}

export interface ReportFinding {
  id: string;
  title: string;
  claim: string;
  evidenceGrade: string;
  classification: string | null;
  confidence: string;
  consensusRatio: number | null;
  segments: string[];
  limitations: string | null;
  votes: ReportVote[];
}

export interface ReportHypothesis {
  label: string;
  statement: string;
  /** Set before the run. Shown beside the result so a reader can judge whether it was met. */
  minimumEvidenceThreshold: string;
  alternativeExplanations: string[];
}

export interface ReportEvidence {
  datasetName: string;
  rowCount: number;
  methodology: string;
  collectionPeriod: string | null;
  fieldCount: number;
  caveats: string[];
}

export interface AssembledReport {
  runId: string;
  projectName: string;
  status: string;
  isMock: boolean;
  isPartial: boolean;
  completedAt: Date | null;
  planHash: string;
  modelProvider: string;
  modelId: string;
  seeds: number[];
  /** Model calls and spend, so the reader can see what this cost and how much was asked. */
  callCount: number;
  spendUsd: number;
  headline: string;
  directAnswer: string;
  qualifiedRecommendation: string;
  confidenceBasis: string;
  groupthinkWarning: boolean;
  /** Never optional and never empty. */
  limitations: string[];
  antiHerd: {
    flipRate: number;
    entropy: number;
    dissentSurvival: number;
    warningRaised: boolean;
  } | null;
  hypotheses: ReportHypothesis[];
  findings: ReportFinding[];
  dissents: { personaKey: string; position: string; note: string | null }[];
  evidence: ReportEvidence[];
  /** Every figure that appears in the evidence, for the claim checker. */
  evidenceFigures: number[];
  panelSize: number;
}

export async function assembleReport(
  user: SessionUser,
  projectId: string,
  runId: string,
): Promise<AssembledReport> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'report.view', projectId)) throw new AuthorizationError('report.view', projectId);

  const run = await prisma.run.findFirst({
    where: { id: runId, projectId },
    include: {
      project: { select: { name: true } },
      config: { include: { datasets: true } },
      findings: { include: { votes: { orderBy: { round: 'asc' } } } },
      metrics: { orderBy: { computedAt: 'desc' }, take: 1 },
      synthesis: { include: { dissents: true } },
      brief: { include: { hypotheses: { orderBy: { createdAt: 'asc' } } } },
    },
  });
  if (!run) throw new AuthorizationError('report.view', projectId);

  const spend = await prisma.modelCall.aggregate({
    where: { runId },
    _sum: { costUsd: true },
    _count: true,
  });

  // Evidence is re-read rather than cached on the run: if the governance permission has since been
  // withdrawn, the report must not keep serving what it once could.
  const evidence: ReportEvidence[] = [];
  const figures: number[] = [];
  for (const d of run.config?.datasets ?? []) {
    try {
      const context = await buildEvidenceContext(d.datasetVersionId);
      evidence.push({
        datasetName: context.datasetName,
        rowCount: context.rowCount,
        methodology: context.methodology,
        collectionPeriod: context.collectionPeriod,
        fieldCount: context.fields.length,
        caveats: context.caveats,
      });
      figures.push(...collectEvidenceFigures(context.fields, context.rowCount));
    } catch {
      evidence.push({
        datasetName: 'Withdrawn',
        rowCount: 0,
        methodology:
          'This dataset is no longer available to the application — its processing permission was ' +
          'withdrawn, or its retention period expired, after this run completed.',
        collectionPeriod: null,
        fieldCount: 0,
        caveats: [
          'The evidence behind this run can no longer be shown. Treat the findings below with ' +
            'corresponding caution: they cannot currently be traced to their source.',
        ],
      });
    }
  }

  const metric = run.metrics[0] ?? null;
  const panelSize = run.findings[0]?.votes.filter((v) => v.round === 1).length ?? 0;

  // Figures the run itself computed from recorded votes, and figures the user wrote into the brief
  // or the cohort's segment labels. Without these, the checker blocked the engine's own headline
  // ("only 33% supported…") and any sentence that quoted the hypothesis ("18–34") — found in an
  // end-to-end run, where every claim in a correct report was refused. These are arithmetic on
  // recorded positions and the user's own wording, not figures a model introduced.
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  for (const f of run.findings) {
    for (const round of [1, 2]) {
      const vs = f.votes.filter((v) => v.round === round);
      for (const kind of ['CONFIRM', 'DISPUTE', 'ABSTAIN']) figures.push(pct(vs.filter((v) => v.vote === kind).length, vs.length));
    }
    const r1 = new Map(f.votes.filter((v) => v.round === 1).map((v) => [v.personaKey, v.vote]));
    const r2 = f.votes.filter((v) => v.round === 2);
    figures.push(pct(r2.filter((v) => r1.has(v.personaKey) && r1.get(v.personaKey) !== v.vote).length, r1.size));
    if (f.consensusRatio !== null) figures.push(Math.round(f.consensusRatio * 100), 100 - Math.round(f.consensusRatio * 100));
    for (const seg of f.segments) for (const m of seg.matchAll(/\d+(?:\.\d+)?/g)) figures.push(Number(m[0]));
  }
  if (metric) {
    for (const v of [metric.flipRate, metric.voteEntropy, metric.dissentSurvival]) {
      if (v !== null && v !== undefined) figures.push(v, Math.round(v * 100), Math.round(v * 100) / 100);
    }
  }
  for (const h of run.brief?.hypotheses ?? []) {
    for (const text of [h.statement, h.minimumEvidenceThreshold ?? '']) {
      for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) figures.push(Number(m[0]));
    }
  }

  const limitations = (run.synthesis?.limitations ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // The standing caveat is added here rather than trusted to have been written earlier. A report
  // with no limitations block is not a report this application produces.
  const standing =
    'Every result here is simulated. It is decision support. It is not evidence of what any real ' +
    'person thinks, believes or would do, and it does not replace research with real people.';
  if (!limitations.some((l) => l.includes('simulated'))) limitations.unshift(standing);
  if (run.isMock && !limitations.some((l) => /mock/i.test(l))) {
    limitations.unshift(
      'This run used the local mock provider. No AI model was consulted; these outputs exist to ' +
        'exercise the pipeline and mean nothing.',
    );
  }
  if (run.isPartial) {
    limitations.push(
      'This run did not complete every stage as configured. The results below are partial, and a ' +
        'missing stage is not a neutral omission.',
    );
  }

  return {
    runId: run.id,
    projectName: run.project.name,
    status: run.status,
    isMock: run.isMock,
    isPartial: run.isPartial,
    completedAt: run.completedAt,
    planHash: run.config?.planHash ?? '',
    modelProvider: run.config?.modelProvider ?? 'unknown',
    modelId: run.config?.modelId ?? 'unknown',
    seeds: run.config?.seeds ?? [],
    callCount: spend._count,
    spendUsd: spend._sum.costUsd ?? 0,
    headline: run.synthesis?.executiveSummary ?? 'This run produced no synthesis.',
    directAnswer: run.synthesis?.directAnswer ?? '',
    qualifiedRecommendation: run.synthesis?.qualifiedRecommendation ?? '',
    confidenceBasis: run.synthesis?.confidenceBasis ?? '',
    groupthinkWarning: run.synthesis?.groupthinkWarning ?? false,
    limitations,
    antiHerd: metric
      ? {
          flipRate: metric.flipRate,
          entropy: metric.voteEntropy,
          dissentSurvival: metric.dissentSurvival,
          warningRaised: metric.warningRaised,
        }
      : null,
    hypotheses: (run.brief?.hypotheses ?? []).map((h) => ({
      label: h.label,
      statement: h.statement,
      minimumEvidenceThreshold: h.minimumEvidenceThreshold,
      alternativeExplanations: h.alternativeExplanations,
    })),
    findings: run.findings.map((f) => {
      const byPersona = new Map<string, ReportVote>();
      for (const v of f.votes) {
        const existing = byPersona.get(v.personaKey) ?? {
          personaKey: v.personaKey,
          independent: null,
          final: null,
          changed: false,
          challenge: null,
          citedEvidence: null,
        };
        if (v.round === 1) {
          existing.independent = v.vote;
          existing.citedEvidence = v.citedEvidence;
        } else {
          existing.final = v.vote;
          existing.challenge = v.challenge;
        }
        byPersona.set(v.personaKey, existing);
      }
      const votes = [...byPersona.values()].map((v) => ({
        ...v,
        changed: v.independent !== null && v.final !== null && v.independent !== v.final,
      }));
      return {
        id: f.id,
        title: f.title,
        claim: f.claim,
        evidenceGrade: f.evidenceGrade,
        classification: f.classification,
        confidence: f.confidence,
        consensusRatio: f.consensusRatio,
        segments: f.segments,
        limitations: f.limitations,
        votes,
      };
    }),
    dissents: (run.synthesis?.dissents ?? []).map((d) => ({
      personaKey: d.personaKey,
      position: d.position,
      note: d.evidenceNote,
    })),
    evidence,
    evidenceFigures: [...new Set(figures)],
    panelSize,
  };
}

/**
 * Render the report as Markdown.
 *
 * The order is deliberate and is the same on screen and in every export: what the run found, then
 * how much to trust it, then what it cannot support — before the detail. A limitations section at
 * the end of a long document is a limitations section nobody reads.
 */
export function renderMarkdown(report: AssembledReport): string {
  const lines: string[] = [];

  lines.push(`# ${report.projectName} — simulation results`);
  lines.push('');

  if (report.isMock) {
    lines.push('> **This run used the mock provider.** No AI model was consulted. Nothing below is');
    lines.push('> a result; it exists to exercise the pipeline.');
    lines.push('');
  }

  lines.push('> **Simulated.** These are outputs of a persona simulation, not observations of');
  lines.push('> people. They are decision support, and they do not replace research with real');
  lines.push('> people.');
  lines.push('');

  lines.push('## What the run found');
  lines.push('');
  lines.push(report.directAnswer || report.headline);
  lines.push('');

  if (report.groupthinkWarning) {
    lines.push('> **Herding was detected in this panel.** The agreement below was produced by');
    lines.push('> exposure to other views, not by independent reasoning. Read it as one view held');
    lines.push('> by many.');
    lines.push('');
  }

  lines.push('## How much to trust it');
  lines.push('');
  lines.push(report.confidenceBasis);
  if (report.antiHerd) {
    lines.push('');
    lines.push(
      `- Flip rate ${report.antiHerd.flipRate.toFixed(2)} · stance entropy ` +
        `${report.antiHerd.entropy.toFixed(2)} · dissent survival ` +
        `${report.antiHerd.dissentSurvival.toFixed(2)}`,
    );
  }
  lines.push('');

  lines.push('## What this cannot support');
  lines.push('');
  for (const l of report.limitations) lines.push(`- ${l}`);
  lines.push('');

  if (report.hypotheses.length > 0) {
    lines.push('## Hypotheses, and the bar set before the run');
    lines.push('');
    for (const h of report.hypotheses) {
      lines.push(`### ${h.label}. ${h.statement}`);
      lines.push('');
      lines.push(`**Set in advance as the bar for support:** ${h.minimumEvidenceThreshold}`);
      if (h.alternativeExplanations.length > 0) {
        lines.push('');
        lines.push(`**Other explanations to rule out:** ${h.alternativeExplanations.join('; ')}`);
      }
      lines.push('');
    }
  }

  lines.push('## Findings');
  lines.push('');
  for (const f of report.findings) {
    lines.push(`### ${f.claim}`);
    lines.push('');
    lines.push(
      `- Evidence grade: **${f.evidenceGrade.replace(/_/g, ' ').toLowerCase()}**` +
        (f.classification ? ` · classification: **${f.classification.toLowerCase()}**` : '') +
        ` · confidence: ${f.confidence.toLowerCase()}`,
    );
    if (f.consensusRatio !== null) {
      lines.push(`- Panel support: ${Math.round(f.consensusRatio * 100)}% of ${report.panelSize}`);
    }
    if (f.limitations) lines.push(`- ${f.limitations}`);
    lines.push('');

    lines.push('| Persona | Alone | After challenge | Changed |');
    lines.push('| --- | --- | --- | --- |');
    for (const v of f.votes) {
      lines.push(
        `| ${v.personaKey} | ${v.independent ?? '—'} | ${v.final ?? '—'} | ${v.changed ? 'yes' : 'no'} |`,
      );
    }
    lines.push('');
  }

  if (report.dissents.length > 0) {
    lines.push('## Dissent');
    lines.push('');
    lines.push('Recorded rather than averaged away. A minority view that survived the challenge');
    lines.push('round is often the most informative thing in a run.');
    lines.push('');
    for (const d of report.dissents) {
      lines.push(`- **${d.personaKey}** (${d.position}): ${d.note ?? ''}`);
    }
    lines.push('');
  }

  lines.push('## Evidence this rests on');
  lines.push('');
  for (const e of report.evidence) {
    lines.push(`### ${e.datasetName}`);
    lines.push('');
    lines.push(`- ${e.rowCount.toLocaleString()} responses, ${e.fieldCount} measures used`);
    lines.push(`- Method: ${e.methodology}`);
    if (e.collectionPeriod) lines.push(`- Collected: ${e.collectionPeriod}`);
    for (const c of e.caveats) lines.push(`- ⚠ ${c}`);
    lines.push('');
  }

  lines.push('## How this run was produced');
  lines.push('');
  lines.push(`- Provider: ${report.modelProvider} (${report.modelId})`);
  lines.push(`- Model calls: ${report.callCount} · recorded spend $${report.spendUsd.toFixed(4)}`);
  lines.push(`- Seeds: ${report.seeds.join(', ')}`);
  lines.push(`- Plan hash: \`${report.planHash}\``);
  lines.push('');
  lines.push(
    'The plan hash identifies the cohort, evidence, brief, model, seeds and prompt version. A run ' +
      'with the same hash asked the same question of the same material in the same way.',
  );

  return lines.join('\n');
}
