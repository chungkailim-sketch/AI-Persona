/**
 * Decision guidance at each checkpoint of the journey (server only).
 *
 * Each checkpoint gathers what has been decided so far — computed from the tables of record, never
 * written by a model — into one input, and asks the decision engine a few questions about what to do
 * next. The answer is guidance with probabilities; nothing in the journey is gated on it.
 */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { assessUsability } from '@/ingest/pipeline';
import { decide, DecisionFailed, type DecisionAnswer, type DecisionQuestion } from './client';
import { availableMarkets, latestBrief, latestCast, latestRoundtable } from '@/roundtable/service';
import { roundtableView, type CastProfile, type ScoredCategory } from '@/roundtable/engine';
import { loadReport } from '@/roundtable/report';

export const CHECKPOINTS = ['DATA', 'BRIEF', 'CAST', 'SWARM_SETUP', 'DEBATE', 'ROUNDTABLE', 'REPORT'] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];

/** Human wording for every choice value, shown next to its probability. */
export const CHOICE_LABEL: Record<string, string> = {
  proceed_to_brief: 'Proceed to the brief',
  upload_more_data: 'Upload more data',
  fix_failed_files: 'Fix the files that failed',
  build_cast: 'Build the personas',
  narrow_markets: 'Narrow the markets',
  sharpen_question: 'Sharpen the question',
  revise_categories: 'Revise the categories',
  approve_cast: 'Approve the personas',
  rebuild_with_other_parameters: 'Rebuild on other parameters',
  add_data: 'Add data',
  act_on_outcome: 'Act on the outcome',
  test_in_market: 'Test it in market first',
  rerun_with_more_rounds: 'Re-run the debate with more rounds',
  refine_motion: 'Refine the motion',
  supported: 'Supported',
  not_supported: 'Not supported',
  mixed: 'Mixed',
  insufficient_evidence: 'Insufficient evidence',
  proceed_to_report: 'Proceed to the report',
  rerun_roundtable: 'Re-run the roundtable',
  revisit_cast: 'Revisit the personas',
  proceed_to_campaign_planning: 'Proceed to campaign planning',
  commission_field_research: 'Commission field research first',
  enter_priority_market_first: 'Enter the priority market first',
  revisit_brief: 'Revisit the brief',
  rounds_1: 'One rebuttal round (quick)',
  rounds_2: 'Two rebuttal rounds (standard)',
  rounds_3: 'Three rebuttal rounds (thorough)',
  compare_suggested: 'Compare the segments the brief names',
  compare_none: 'No segment comparison',
  run_swarm_debate: 'Run the swarm debate',
  run_roundtable_first: 'Run the roundtable first',
  approve_cast_first: 'Approve the personas first',
};

export const QUESTION_LABEL: Record<string, string> = {
  ready: 'The data is ready to build personas',
  motion: 'Motion most likely to give a usable answer',
  rounds: 'Rebuttal rounds',
  compare: 'Segment comparison',
  swarm_ready: 'The personas can argue this motion from their data',
  next: 'Recommended next step',
  clear: 'The question can be answered from consumer survey data',
  fit: 'Fit between the brief and the data',
  coverage: 'Every market is covered by distinct, adequately based personas',
  distinct: 'How distinct the personas are',
  outcome: 'Outcome of the debate',
  strength: 'Strength of the evidence behind it',
  priority_market: 'Market to prioritise',
  lead_category: 'Lead category',
  consensus: 'Strength of the consensus',
  actionable: 'The results are clear enough to act on',
  ready_for_client: 'The report is ready to share with the client',
};

const choice = (name: string, instructions: string, values: string[]): DecisionQuestion => ({
  name,
  type: 'choice',
  instructions,
  choices: values.map((v) => ({ value: v, description: CHOICE_LABEL[v] ?? v })),
});
const LEVELS = (labels: string[]) => labels.map((label) => ({ label }));

interface Built {
  input: string;
  questions: DecisionQuestion[];
  subjectId?: string;
}

async function buildData(projectId: string): Promise<Built> {
  const links = await prisma.projectDataset.findMany({
    where: { projectId, dataset: { deletedAt: null } },
    include: { dataset: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
  });
  const lines: string[] = [];
  for (const l of links) {
    const v = l.dataset.versions[0];
    if (!v) continue;
    const usable = (await assessUsability(v.id)).usable;
    lines.push(`- ${l.dataset.name}: ${v.status}${usable ? ', ready' : ', not ready'}${v.rowCount ? `, ${v.rowCount} rows` : ''}`);
  }
  const markets = await availableMarkets(projectId);
  return {
    input: [
      'Checkpoint: source data for a consumer persona study (simulated personas built from published survey statistics).',
      `Files (${lines.length}):`,
      ...(lines.length ? lines : ['- none']),
      `Markets found in the ready data: ${markets.join(', ') || 'none'}`,
    ].join('\n'),
    questions: [
      { name: 'ready', type: 'predicate', instructions: 'The ready data is sufficient to build personas for at least one market: files imported and markets identified.' },
      choice('next', 'The most useful next step for the team.', ['proceed_to_brief', 'upload_more_data', 'fix_failed_files']),
    ],
  };
}

async function buildBrief(projectId: string): Promise<Built> {
  const [brief, markets] = await Promise.all([latestBrief(projectId), availableMarkets(projectId)]);
  return {
    input: [
      'Checkpoint: the brief for a simulated consumer roundtable built from survey data.',
      `Brand and category context: ${brief?.businessContext ?? '—'}`,
      `Question: ${brief?.researchQuestion ?? '—'}`,
      `Categories: ${(brief?.categories ?? []).join('; ') || '—'}`,
      `Chosen markets: ${(brief?.markets ?? []).join(', ') || '—'}`,
      `Markets in the data: ${markets.join(', ') || '—'}`,
    ].join('\n'),
    questions: [
      { name: 'clear', type: 'predicate', instructions: 'The question is specific and can be answered by consumers scoring the listed categories.' },
      { name: 'fit', type: 'score', instructions: 'How well the brief matches what the data can say about these markets.', levels: LEVELS(['Poor', 'Fair', 'Good', 'Excellent']) },
      choice('next', 'The most useful next step.', ['build_cast', 'narrow_markets', 'sharpen_question', 'revise_categories']),
    ],
  };
}

async function buildCast(projectId: string): Promise<Built> {
  const cast = await latestCast(projectId);
  const lines = (cast?.personas ?? []).map((p) => {
    const pr = p.versions[0]?.profile as unknown as CastProfile | null;
    if (!pr) return `- ${p.name}`;
    const stats = pr.stats.slice(0, 3).map((s) => `${s.statement} ${s.response} ${s.share}% vs ${s.overall}%`).join('; ');
    return `- ${pr.market}, ${pr.group ?? 'tier'} ${pr.tierLabel} (base ${pr.base}): ${stats}`;
  });
  return {
    subjectId: cast?.id,
    input: ['Checkpoint: the persona cast (each persona is a published segment of a market).', `Personas (${lines.length}):`, ...(lines.length ? lines : ['- none built yet'])].join('\n'),
    questions: [
      { name: 'coverage', type: 'predicate', instructions: 'Every chosen market is covered by personas that differ from each other and rest on bases of at least 30 respondents.' },
      { name: 'distinct', type: 'score', instructions: 'How clearly the personas differ from one another on what they stand out for.', levels: LEVELS(['Barely', 'Somewhat', 'Clearly', 'Sharply']) },
      choice('next', 'The most useful next step.', ['approve_cast', 'rebuild_with_other_parameters', 'add_data']),
    ],
  };
}

async function buildSwarmSetup(projectId: string): Promise<Built> {
  const [brief, cast, imported] = await Promise.all([
    latestBrief(projectId),
    latestCast(projectId),
    prisma.advice.findFirst({ where: { projectId, kind: 'BRIEF_IMPORT', status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } }),
  ]);
  const swarm = ((imported?.content ?? {}) as { swarm?: { topic?: string; hypothesis?: string; focusSegments?: string[] } }).swarm ?? {};
  const hypotheses = brief ? await prisma.hypothesis.findMany({ where: { briefId: brief.id }, select: { statement: true }, take: 4 }) : [];
  const motions = [...new Set([swarm.topic, ...hypotheses.map((h) => h.statement), brief?.researchQuestion].filter((m): m is string => Boolean(m && m.trim())))].slice(0, 4);
  const approved = (cast?.personas ?? []).filter((p) => p.versions[0]?.approval === 'APPROVED').length;
  const markets = [...new Set((cast?.personas ?? []).map((p) => (p.versions[0]?.profile as unknown as CastProfile | null)?.market).filter(Boolean))];
  const qs: DecisionQuestion[] = [
    { name: 'swarm_ready', type: 'predicate', instructions: 'The approved personas, built from survey data on these markets, can argue the leading motion from their own data.' },
    choice('rounds', 'How many rebuttal rounds give a clear verdict without repetition.', ['rounds_1', 'rounds_2', 'rounds_3']),
    choice('next', 'The most useful next step.', ['run_swarm_debate', 'run_roundtable_first', 'approve_cast_first', 'refine_motion']),
  ];
  if (motions.length >= 2) qs.unshift({ name: 'motion', type: 'choice', instructions: 'The motion most likely to give the team a clear, usable answer.', choices: motions.map((m) => ({ value: m, description: m })) });
  if (swarm.focusSegments?.length === 2) qs.splice(2, 0, choice('compare', `Whether to compare ${swarm.focusSegments.join(' with ')}.`, ['compare_suggested', 'compare_none']));
  return {
    subjectId: cast?.id,
    input: [
      'Checkpoint: setting up an agent-swarm debate among simulated consumer personas built from survey data.',
      `Brand and category context: ${brief?.businessContext ?? '—'}`,
      `Roundtable question: ${brief?.researchQuestion ?? '—'}`,
      `Candidate motions: ${motions.join(' | ') || '—'}`,
      swarm.hypothesis ? `Hypothesis suggested by the brief: ${swarm.hypothesis}` : '',
      swarm.focusSegments?.length ? `Segments the brief names: ${swarm.focusSegments.join(', ')}` : '',
      `Personas: ${approved} approved of ${cast?.personas.length ?? 0}; markets ${markets.join(', ') || '—'}.`,
    ].filter(Boolean).join('\n'),
    questions: qs,
  };
}

async function buildDebate(projectId: string, debateId?: string): Promise<Built> {
  const debate = await prisma.debate.findFirst({
    where: { projectId, status: 'COMPLETED', ...(debateId ? { id: debateId } : {}) },
    orderBy: { createdAt: 'desc' },
    include: { turns: { where: { phase: 'CLOSING' }, orderBy: { seq: 'asc' } } },
  });
  const verdict = ((debate?.conclusion ?? {}) as { verdict?: Record<string, unknown> }).verdict ?? null;
  const closings = (debate?.turns ?? []).map((t) => `- ${t.agentName}: ${t.stance ?? 'no stance'} — ${String((t.content as Record<string, unknown>).finalArgument ?? '').slice(0, 400)}`);
  return {
    subjectId: debate?.id,
    input: [
      'Checkpoint: an agent-swarm debate among simulated consumer personas built from survey data.',
      `Motion: ${debate?.topic ?? '—'}`,
      debate?.hypothesis ? `Hypothesis: ${debate.hypothesis}` : '',
      verdict ? `Judge: ${String(verdict.answer)} (${String(verdict.confidence)}) — ${String(verdict.conclusion ?? '').slice(0, 1500)}` : 'No verdict.',
      'Closing positions:',
      ...(closings.length ? closings : ['- none']),
    ].filter(Boolean).join('\n'),
    questions: [
      choice('outcome', 'What the debate, taken as a whole, concludes about the motion.', ['supported', 'not_supported', 'mixed', 'insufficient_evidence']),
      { name: 'strength', type: 'score', instructions: 'How strong the evidence behind that outcome is.', levels: LEVELS(['Weak', 'Moderate', 'Strong', 'Very strong']) },
      choice('next', 'What the team should do with this outcome.', ['act_on_outcome', 'test_in_market', 'rerun_with_more_rounds', 'refine_motion']),
    ],
  };
}

async function buildRoundtable(projectId: string): Promise<Built> {
  const rt = await latestRoundtable(projectId);
  if (!rt || rt.status !== 'COMPLETED') {
    return { input: 'Checkpoint: roundtable. No roundtable has completed yet.', questions: [choice('next', 'The most useful next step.', ['revisit_cast', 'rerun_roundtable'])] };
  }
  const answers = rt.answers.filter((a) => a.ok).map((a) => ({ ...a, scores: (a.scores ?? []) as unknown as ScoredCategory[] }));
  const view = roundtableView(rt.categories, answers);
  const markets = view.markets.map((m) => m.market);
  const qs: DecisionQuestion[] = [
    { name: 'consensus', type: 'score', instructions: 'How far the personas agree with one another.', levels: LEVELS(['Split', 'Weak', 'Moderate', 'Strong']) },
    { name: 'actionable', type: 'predicate', instructions: 'The differences between markets and categories are large enough to act on.' },
    choice('next', 'The most useful next step.', ['proceed_to_report', 'rerun_roundtable', 'revisit_cast']),
  ];
  if (markets.length >= 2) qs.unshift(choice('priority_market', 'The market a Chinese brand should prioritise, from these results.', markets));
  if (rt.categories.length >= 2) qs.splice(1, 0, choice('lead_category', 'The category to lead with.', rt.categories));
  return {
    subjectId: rt.id,
    input: [
      `Checkpoint: a simulated consumer roundtable. Question: ${rt.question}`,
      `Mean openness by market (0–100): ${view.markets.map((m) => `${m.market} ${Math.round(m.overall)}`).join('; ')}`,
      'Mean openness by category and market:',
      ...rt.categories.map((c) => `- ${c}: overall ${Math.round(view.categoryMeans[c] ?? 0)}; ${view.markets.map((m) => `${m.market} ${m.categories[c] === undefined ? '—' : Math.round(m.categories[c]!)}`).join(', ')}`),
      `Personas: ${view.bands.willing} willing, ${view.bands.depends} depends, ${view.bands.unlikely} not keen.`,
    ].join('\n'),
    questions: qs,
  };
}

async function buildReport(projectId: string): Promise<Built> {
  const r = await loadReport(projectId);
  if (!r) return { input: 'Checkpoint: report. No roundtable has completed yet.', questions: [choice('next', 'The most useful next step.', ['revisit_brief', 'commission_field_research'])] };
  return {
    subjectId: r.roundtable.id,
    input: [
      `Checkpoint: the market-entry report for "${r.projectName}". Question: ${r.roundtable.question}`,
      `Market potential index: ${r.potential.map((p) => `${p.market} ${p.score ?? '—'} (${p.tier ?? '—'}${p.missing.length ? `, missing ${p.missing.join('/')}` : ''})`).join('; ')}`,
      `Market entry index: ${r.entry.map((e) => `${e.market} ${e.score ?? '—'}, lead ${e.lead ?? '—'}`).join('; ')}`,
      `Takeaways: ${(r.summary?.takeaways ?? []).join(' | ')}`,
      r.roundtable.isMock ? 'Note: produced with a mock model.' : '',
    ].filter(Boolean).join('\n'),
    questions: [
      { name: 'ready_for_client', type: 'predicate', instructions: 'The report is complete and well-supported enough to share with the client: indices have their inputs and the takeaways follow from the numbers.' },
      choice('next', 'The most useful next step for the client.', ['proceed_to_campaign_planning', 'enter_priority_market_first', 'commission_field_research', 'revisit_brief']),
    ],
  };
}

export async function buildCheckpoint(projectId: string, checkpoint: Checkpoint, subjectId?: string): Promise<Built> {
  switch (checkpoint) {
    case 'DATA': return buildData(projectId);
    case 'BRIEF': return buildBrief(projectId);
    case 'CAST': return buildCast(projectId);
    case 'SWARM_SETUP': return buildSwarmSetup(projectId);
    case 'DEBATE': return buildDebate(projectId, subjectId);
    case 'ROUNDTABLE': return buildRoundtable(projectId);
    case 'REPORT': return buildReport(projectId);
  }
}

/** Ask for guidance and record it — the record is kept whether the call succeeds or fails. */
export async function recordCheckpoint(projectId: string, checkpoint: Checkpoint, createdById: string, subjectId?: string) {
  const built = await buildCheckpoint(projectId, checkpoint, subjectId);
  try {
    const r = await decide(built.input, built.questions);
    return prisma.decisionCheck.create({
      data: { projectId, checkpoint, subjectId: built.subjectId ?? subjectId ?? null, input: built.input, questions: built.questions as object, answers: r.answers as object, isMock: r.isMock, modelId: r.modelId, createdById },
    });
  } catch (e) {
    const message = e instanceof DecisionFailed ? e.message : 'Decision guidance could not be produced.';
    if (!(e instanceof DecisionFailed)) console.error('[decision] unexpected failure', e);
    return prisma.decisionCheck.create({
      data: { projectId, checkpoint, subjectId: built.subjectId ?? subjectId ?? null, input: built.input, questions: built.questions as object, status: 'FAILED', error: message, isMock: false, createdById },
    });
  }
}

export async function requestGuidance(user: SessionUser, projectId: string, checkpoint: Checkpoint, subjectId?: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.edit', projectId)) throw new AuthorizationError('project.edit', projectId);
  return recordCheckpoint(projectId, checkpoint, user.userId, subjectId);
}

export async function latestGuidance(projectId: string, checkpoint: Checkpoint, subjectId?: string) {
  return prisma.decisionCheck.findFirst({ where: { projectId, checkpoint, ...(subjectId ? { subjectId } : {}) }, orderBy: { createdAt: 'desc' } });
}

export type { DecisionAnswer };
