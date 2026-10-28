/**
 * Everything the slide report shows, read and computed in one place (server only). Figures are
 * computed here from stored answers and market inputs; the model's words come from the summary.
 */
import { prisma } from '@/lib/prisma';
import { marketInputs } from './service';
import { roundtableView, type AnswerLike, type CastProfile, type ScoredCategory } from './engine';
import { entryIndex, potentialIndex } from './marketIndex';
import type { RoundtableSummary } from './schemas';

export interface ReportPersona {
  id: string;
  name: string;
  profile: CastProfile;
  answer: (AnswerLike & { conditions: string[]; barriers: string[]; profile: ReportAnswerProfile | null }) | null;
}

export interface ReportAnswerProfile {
  mindset: { label: string; value: string }[];
  howToReach: string[];
  holdsBack: string[];
  commsAdvice: string[];
}

export async function loadReport(projectId: string) {
  const [project, brief, rt] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { name: true, description: true } }),
    prisma.brief.findFirst({ where: { projectId }, orderBy: { versionNo: 'desc' }, select: { businessContext: true, targetAudience: true } }),
    prisma.roundtable.findFirst({ where: { projectId, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' }, include: { answers: true } }),
  ]);
  if (!project || !rt) return null;

  const personas = await prisma.persona.findMany({
    where: { cohortId: rt.cohortId },
    orderBy: { createdAt: 'asc' },
    include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { profile: true } } },
  });
  const answers = rt.answers.filter((a) => a.ok).map((a) => ({
    personaId: a.personaId,
    market: a.market,
    tier: a.tier,
    overall: a.overall,
    quote: a.quote,
    scores: (a.scores ?? []) as unknown as ScoredCategory[],
    conditions: a.conditions,
    barriers: a.barriers,
    profile: (a.profile ?? null) as unknown as ReportAnswerProfile | null,
  }));
  const cast: ReportPersona[] = personas
    .map((p) => ({ id: p.id, name: p.name, profile: p.versions[0]?.profile as unknown as CastProfile, answer: answers.find((a) => a.personaId === p.id) ?? null }))
    .filter((p) => p.profile);
  const view = roundtableView(rt.categories, answers);
  const inputs = await marketInputs(projectId);
  const castMarkets = [...new Set(cast.map((p) => p.profile.market))];
  const markets = [...castMarkets, ...inputs.map((i) => i.market).filter((m) => !castMarkets.some((c) => c.toLowerCase() === m.toLowerCase()))];
  return {
    projectName: project.name,
    context: brief?.businessContext ?? null,
    audience: brief?.targetAudience ?? null,
    roundtable: { id: rt.id, question: rt.question, categories: rt.categories, language: rt.language, isMock: rt.isMock, completedAt: rt.completedAt, spendUsd: rt.spendUsd, failureReason: rt.failureReason },
    summary: (rt.summary ?? null) as RoundtableSummary | null,
    cast,
    castMarkets,
    view,
    inputs,
    potential: potentialIndex(markets, inputs, view.markets),
    entry: entryIndex(markets, rt.categories, inputs, view.markets),
  };
}

export type Report = NonNullable<Awaited<ReturnType<typeof loadReport>>>;
