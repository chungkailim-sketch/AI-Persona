/**
 * The simplified journey, server side: the short brief, the cast, the roundtable and the market
 * inputs. Building a cast and running a roundtable spend model budget, so they need the same
 * permissions as generating a cohort and starting a run, run on the worker, and are audited.
 */
import { randomInt } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { enqueue } from '@/queue/queue';
import { recordAudit } from '@/lib/audit';
import { assessUsability } from '@/ingest/pipeline';
import { approveCohort } from '@/server/personas';
import { PILLARS, type Pillar } from './marketIndex';
import type { Lang } from './engine';

export const DEFAULT_QUESTION: Record<Lang, string> = {
  en: 'In the next one year, which categories would you be willing to try a Chinese brand in?',
  zh: '未来一年内，您愿意在哪些品类中尝试中国品牌？',
};

export const DEFAULT_CATEGORIES: Record<Lang, string[]> = {
  en: ['Beauty & personal care', 'Food & beverage', 'Health & wellness', 'Home & appliances', 'Fashion & apparel', 'Travel', 'Entertainment & games', 'Tech & digital'],
  zh: ['美妆个护', '食品饮料', '健康保健', '家居家电', '服装时尚', '旅游出行', '娱乐游戏', '科技数码'],
};

export class JourneyRefused extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'JourneyRefused';
  }
}

async function requirePermission(user: SessionUser, projectId: string, permission: Parameters<typeof can>[1]) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, permission, projectId)) throw new AuthorizationError(permission, projectId);
}

/** Markets present in the cleared data, read from the profiled "market" field (no file is read). */
export async function availableMarkets(projectId: string): Promise<string[]> {
  const links = await prisma.projectDataset.findMany({
    where: { projectId, dataset: { deletedAt: null } },
    include: { dataset: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, include: { fields: { where: { name: { equals: 'market', mode: 'insensitive' } } } } } } } },
  });
  const markets = new Set<string>();
  for (const l of links) {
    const v = l.dataset.versions[0];
    if (!v || !(await assessUsability(v.id)).usable) continue;
    for (const f of v.fields) {
      const p = f.profile as { withheld?: boolean; topValues?: { value: string }[] } | null;
      for (const t of p?.withheld ? [] : (p?.topValues ?? [])) if (t.value?.trim() && !/^all( markets)?$/i.test(t.value.trim())) markets.add(t.value.trim());
    }
  }
  return [...markets].sort((a, b) => a.localeCompare(b));
}

// ── Brief ─────────────────────────────────────────────────────────────────────

export interface StudyBriefInput {
  context: string;
  markets: string[];
  question: string;
  categories: string[];
  audience?: string;
}

export async function latestBrief(projectId: string) {
  return prisma.brief.findFirst({ where: { projectId }, orderBy: { versionNo: 'desc' } });
}

/** The brief is ready for a cast when it names markets, a question and at least two categories. */
export function studyBriefMissing(b: { markets: string[]; researchQuestion: string | null; categories: string[] } | null): string[] {
  const missing: string[] = [];
  if (!b || b.markets.length === 0) missing.push('Choose at least one market.');
  if (!b || (b.researchQuestion ?? '').trim().length < 10) missing.push('Enter the roundtable question.');
  if (!b || b.categories.length < 2) missing.push('List at least two categories.');
  return missing;
}

export async function saveStudyBrief(user: SessionUser, projectId: string, input: StudyBriefInput): Promise<{ briefId: string }> {
  await requirePermission(user, projectId, 'project.edit');
  const markets = [...new Set(input.markets.map((m) => m.trim()).filter(Boolean))].slice(0, 20);
  const categories = [...new Set(input.categories.map((c) => c.trim()).filter(Boolean))].slice(0, 12);
  const question = input.question.trim();
  const problems: string[] = [];
  if (question.length < 10) problems.push('Enter the roundtable question in at least a sentence.');
  if (question.length > 600) problems.push('Keep the question under 600 characters.');
  if (markets.length === 0) problems.push('Choose at least one market.');
  if (categories.length < 2) problems.push('List at least two categories.');
  if (input.context.length > 3000) problems.push('Keep the brand and category context under 3,000 characters.');
  if (problems.length) throw new JourneyRefused(problems);

  const data = {
    businessContext: input.context.trim() || null,
    researchQuestion: question,
    markets,
    categories,
    targetAudience: input.audience?.trim() || null,
  };
  const latest = await latestBrief(projectId);
  // A brief a run has used is never edited in place; the change becomes a new version.
  const brief = latest && latest.status !== 'LOCKED'
    ? await prisma.brief.update({ where: { id: latest.id }, data })
    : await prisma.brief.create({ data: { projectId, versionNo: (latest?.versionNo ?? 0) + 1, createdById: user.userId, ...data } });
  return { briefId: brief.id };
}

// ── Cast ──────────────────────────────────────────────────────────────────────

export async function latestCast(projectId: string) {
  return prisma.cohort.findFirst({
    where: { projectId, kind: 'cast' },
    orderBy: { generatedAt: 'desc' },
    include: {
      personas: {
        orderBy: { createdAt: 'asc' },
        include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, include: { attributes: { where: { group: 'attitudes' } } } } },
      },
    },
  });
}

export async function requestCast(user: SessionUser, projectId: string, lang: Lang): Promise<{ cohortId: string }> {
  await requirePermission(user, projectId, 'persona.create');
  const brief = await latestBrief(projectId);
  const missing = studyBriefMissing(brief);
  if (missing.length) throw new JourneyRefused(['Complete the brief first.', ...missing]);
  const running = await prisma.cohort.findFirst({ where: { projectId, kind: 'cast', buildStatus: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } });
  if (running) throw new JourneyRefused(['A cast is already being built. Wait for it to finish.']);

  const seed = randomInt(1, 2_000_000_000);
  const cohort = await prisma.cohort.create({
    data: { projectId, name: `Cast · ${brief!.markets.join(', ')}`.slice(0, 200), mode: 'CLUSTER', kind: 'cast', buildStatus: 'QUEUED' },
  });
  await enqueue({
    kind: 'cast',
    input: { cohortId: cohort.id, markets: brief!.markets, language: lang, context: brief!.businessContext, seed },
    idempotencyKey: `cast:${cohort.id}`,
    maxAttempts: 2,
  });
  await recordAudit({ action: 'persona.cast.requested', targetType: 'cohort', targetId: cohort.id, projectId, actorUserId: user.userId, actorEmail: user.email, reason: `Cast for ${brief!.markets.join(', ')}` });
  return { cohortId: cohort.id };
}

export async function approveCast(user: SessionUser, projectId: string, cohortId: string): Promise<void> {
  const cohort = await prisma.cohort.findFirst({ where: { id: cohortId, projectId, kind: 'cast' }, select: { buildStatus: true } });
  if (!cohort) throw new JourneyRefused(['That cast is not part of this project.']);
  if (cohort.buildStatus !== 'COMPLETED') throw new JourneyRefused(['Wait for the cast to finish building.']);
  await approveCohort(user, projectId, cohortId);
}

/** Rename a cast persona — the illustrative name is the team's to choose. */
export async function renameCastPersona(user: SessionUser, projectId: string, personaId: string, name: string): Promise<void> {
  await requirePermission(user, projectId, 'persona.edit');
  const clean = name.trim().slice(0, 60);
  if (clean.length < 1) throw new JourneyRefused(['Enter a name.']);
  const persona = await prisma.persona.findFirst({
    where: { id: personaId, cohort: { projectId, kind: 'cast' } },
    include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } },
  });
  if (!persona) throw new JourneyRefused(['That persona is not part of this project.']);
  const v = persona.versions[0];
  const profile = (v?.profile ?? {}) as { identity?: Record<string, unknown> };
  await prisma.$transaction([
    prisma.persona.update({ where: { id: personaId }, data: { name: clean } }),
    ...(v && profile.identity ? [prisma.personaVersion.update({ where: { id: v.id }, data: { profile: { ...profile, identity: { ...profile.identity, name: clean } } as object } })] : []),
  ]);
}

// ── Roundtable ────────────────────────────────────────────────────────────────

export async function latestRoundtable(projectId: string) {
  return prisma.roundtable.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, include: { answers: true } });
}

export async function requestRoundtable(user: SessionUser, projectId: string, lang: Lang): Promise<{ roundtableId: string }> {
  await requirePermission(user, projectId, 'simulation.run');
  const brief = await latestBrief(projectId);
  const problems = studyBriefMissing(brief);
  const cast = await latestCast(projectId);
  if (!cast || cast.buildStatus !== 'COMPLETED') problems.push('Build the cast first.');
  else if (cast.personas.length === 0 || cast.personas.some((p) => p.versions[0]?.approval !== 'APPROVED')) problems.push('Approve the cast first.');
  const running = await prisma.roundtable.findFirst({ where: { projectId, status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } });
  if (running) problems.push('A roundtable is already running. Wait for it to finish.');
  if (problems.length) throw new JourneyRefused(problems);

  const rt = await prisma.roundtable.create({
    data: {
      projectId,
      cohortId: cast!.id,
      question: brief!.researchQuestion!,
      categories: brief!.categories,
      context: brief!.businessContext,
      language: lang,
      seed: randomInt(1, 2_000_000_000),
      total: cast!.personas.length,
      createdById: user.userId,
    },
  });
  // A brief that a roundtable has used is kept as it was; a later edit becomes a new version.
  await prisma.brief.update({ where: { id: brief!.id }, data: { status: 'LOCKED' } });
  await enqueue({ kind: 'roundtable', input: { roundtableId: rt.id }, idempotencyKey: `roundtable:${rt.id}`, maxAttempts: 2 });
  await recordAudit({ action: 'roundtable.requested', targetType: 'roundtable', targetId: rt.id, projectId, actorUserId: user.userId, actorEmail: user.email, reason: `Roundtable with ${cast!.personas.length} persona(s)` });
  return { roundtableId: rt.id };
}

// ── Market inputs ─────────────────────────────────────────────────────────────

export async function marketInputs(projectId: string) {
  return prisma.marketInput.findMany({ where: { projectId }, orderBy: { market: 'asc' } });
}

export async function saveMarketInputs(
  user: SessionUser,
  projectId: string,
  rows: ({ market: string; source?: string | null } & Partial<Record<Pillar, number | null>>)[],
): Promise<void> {
  await requirePermission(user, projectId, 'project.edit');
  const problems: string[] = [];
  for (const r of rows) {
    for (const p of PILLARS) {
      const v = r[p];
      if (v !== null && v !== undefined && !(Number.isFinite(v) && v >= 0 && v <= 100)) problems.push(`${r.market}: every pillar is a score from 0 to 100.`);
    }
  }
  if (problems.length) throw new JourneyRefused([...new Set(problems)]);
  await prisma.$transaction(
    rows
      .filter((r) => r.market.trim())
      .map((r) => {
        const data = { ...Object.fromEntries(PILLARS.map((p) => [p, r[p] ?? null])), source: r.source?.trim().slice(0, 500) || null, updatedById: user.userId };
        return prisma.marketInput.upsert({ where: { projectId_market: { projectId, market: r.market.trim() } }, create: { projectId, market: r.market.trim(), ...data }, update: data });
      }),
  );
  await recordAudit({ action: 'market_inputs.saved', targetType: 'project', targetId: projectId, projectId, actorUserId: user.userId, actorEmail: user.email, reason: `${rows.length} market(s)` });
}
