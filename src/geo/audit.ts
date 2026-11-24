/**
 * GEO (generative engine optimisation) audits, uploaded on the Brief step (server only; the reading
 * happens on the worker).
 *
 * An AI visibility audit — how often AI answer engines (ChatGPT/OpenAI, Gemini, Google AI Mode and
 * AI Overviews, Perplexity…) name and cite a brand against its competitors, by topic, by engine and
 * by the sources they cite — is read in two steps:
 *
 *   1. its metrics are read out of the file (a PDF is read by the model directly; other formats are
 *      turned into text in code first), with the market it measures, stated or inferred;
 *   2. the gaps that matter are computed in code (src/geo/analysis.ts), and a GEO communication
 *      strategy for that market is written from them together with the study (the brief, and the
 *      personas and roundtable answers for that market): content strategy, go-to-market tactics,
 *      content formats, channels from the source analysis, media relations, where to invest, KPIs.
 *
 * The result is a GEO section in the report deck and evidence for the plan writer and the creative
 * brief, so the communication strategy is one piece.
 */
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { storage } from '@/storage/adapter';
import { enqueue } from '@/queue/queue';
import { recordAudit } from '@/lib/audit';
import { callModel } from '@/model/client';
import { deriveSeed } from '@/model/provider';
import { wrapUntrusted } from '@/model/context';
import { authContextFor, type SessionUser } from '@/auth/session';
import { can } from '@/auth/permissions';
import { AuthorizationError } from '@/auth/guard';
import { availableMarkets, JourneyRefused, latestBrief } from '@/roundtable/service';
import { marketsMentioned } from '@/roundtable/selection';
import { loadReport } from '@/roundtable/report';
import { segmentLine, type Lang } from '@/roundtable/engine';
import { BRIEF_MAX_BYTES, readBriefFile } from '@/advice/briefImport';
import { GeoMetrics, GeoStrategy } from './schemas';
import { analyseGeo, type GeoAnalysis } from './analysis';

export const GEO_PROMPT_VERSION = '1.0.0';

interface GeoOptions { storageKey: string; fileName: string; mimeType: string; language: Lang }

export interface GeoContent {
  metrics: GeoMetrics;
  analysis: GeoAnalysis;
  strategy: GeoStrategy;
  /** The study market the audit's market matches, if the study covers it. */
  matchedMarket: string | null;
}

export interface GeoAuditView { id: string; fileName: string; status: string; failureReason: string | null; isMock: boolean; createdAt: Date; content: GeoContent | null }

// ── Request, list, delete ─────────────────────────────────────────────────────

export async function requestGeoAudit(user: SessionUser, projectId: string, file: { name: string; type: string; bytes: Buffer }, language: Lang) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.edit', projectId)) throw new AuthorizationError('project.edit', projectId);
  if (file.bytes.length === 0) throw new JourneyRefused(['The file is empty.']);
  if (file.bytes.length > BRIEF_MAX_BYTES) throw new JourneyRefused(['The file is larger than 15 MB. Save a smaller copy (for example, as PDF without images) and try again.']);
  const stored = await storage().put(`geo-audits/${projectId}`, file.bytes);
  const fileName = file.name.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 160) || 'geo-audit';
  const advice = await prisma.advice.create({
    data: { projectId, kind: 'GEO_AUDIT', question: fileName, options: { storageKey: stored.key, fileName, mimeType: file.type.slice(0, 120), language } satisfies GeoOptions as object, createdById: user.userId },
  });
  await enqueue({ kind: 'geo_audit', input: { adviceId: advice.id }, idempotencyKey: `geo_audit:${advice.id}`, maxAttempts: 1 });
  await recordAudit({ action: 'geo.audit.uploaded', targetType: 'project', targetId: projectId, projectId, actorUserId: user.userId, actorEmail: user.email, reason: `GEO audit uploaded: ${fileName}` });
  return { adviceId: advice.id };
}

export async function listGeoAudits(projectId: string): Promise<GeoAuditView[]> {
  const rows = await prisma.advice.findMany({ where: { projectId, kind: 'GEO_AUDIT' }, orderBy: { createdAt: 'desc' }, take: 20 });
  return rows.map((r) => ({ id: r.id, fileName: r.question, status: r.status, failureReason: r.failureReason, isMock: r.isMock, createdAt: r.createdAt, content: r.status === 'COMPLETED' ? (r.content as unknown as GeoContent) : null }));
}

/** Completed audits, oldest first: what the report and the plan writer use. */
export async function completedGeoAudits(projectId: string): Promise<(GeoContent & { id: string; isMock: boolean })[]> {
  const rows = await prisma.advice.findMany({ where: { projectId, kind: 'GEO_AUDIT', status: 'COMPLETED' }, orderBy: { createdAt: 'asc' }, take: 6 });
  return rows.filter((r) => r.content).map((r) => ({ id: r.id, isMock: r.isMock, ...(r.content as unknown as GeoContent) }));
}

async function ownAudit(user: SessionUser, projectId: string, id: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.edit', projectId)) throw new AuthorizationError('project.edit', projectId);
  const a = await prisma.advice.findFirst({ where: { id, projectId, kind: 'GEO_AUDIT' } });
  if (!a) throw new JourneyRefused(['That GEO audit is not part of this project.']);
  return a;
}

export async function deleteGeoAudit(user: SessionUser, projectId: string, id: string): Promise<void> {
  const a = await ownAudit(user, projectId, id);
  if (a.status === 'QUEUED' || a.status === 'RUNNING') throw new JourneyRefused(['This audit is still being read. Wait for it to finish.']);
  await prisma.advice.delete({ where: { id } });
  await recordAudit({ action: 'geo.audit.deleted', targetType: 'project', targetId: projectId, projectId, actorUserId: user.userId, actorEmail: user.email, reason: `GEO audit deleted: ${a.question}` });
}

/** Read the same file again, e.g. after the study's personas or roundtable changed. */
export async function rereadGeoAudit(user: SessionUser, projectId: string, id: string, language: Lang): Promise<void> {
  const a = await ownAudit(user, projectId, id);
  if (a.status === 'QUEUED' || a.status === 'RUNNING') throw new JourneyRefused(['This audit is already being read.']);
  await prisma.advice.update({ where: { id }, data: { status: 'QUEUED', failureReason: null, completedAt: null, options: { ...((a.options ?? {}) as object), language } } });
  await enqueue({ kind: 'geo_audit', input: { adviceId: id }, idempotencyKey: `geo_audit:${id}:${Date.now()}`, maxAttempts: 1 });
}

// ── Reading (worker) ──────────────────────────────────────────────────────────

class GeoFailed extends Error {}

const METRICS_SHAPE =
  '{ "brand": string, "reportTitle": string, "period": string, "market": string, "marketBasis": "stated" | "inferred", "marketEvidence": string, ' +
  '"engines": number, "topics": number, ' +
  '"headline": { "visibility": number, "mentions": number, "citationShare": number, "avgRank": number, "rank": number, "brandsTracked": number, "marketShare": number, "brandedVisibility": number }, ' +
  '"competitors": [{ "name": string, "mentions": number, "visibility": number, "brandedVisibility": number }], ' +
  '"topicScores": [{ "topic": string, "brand": number, "leader": string, "leaderScore": number }], ' +
  '"engineScores": [{ "engine": string, "mentions": number }], ' +
  '"sourceTypes": [{ "type": string, "share": number }], ' +
  '"industrySources": [{ "domain": string, "share": number, "citations": string }], ' +
  '"brandedSources": [{ "domain": string, "share": number }], ' +
  '"ownedDomains": [{ "brand": string, "domain": string, "share": number, "rank": number }], ' +
  '"topPages": [{ "page": string, "brand": string, "note": string }], ' +
  '"battlegrounds": [{ "name": string, "topics": string, "position": string, "keyDomains": string[] }], ' +
  '"trend": string, "recommendations": [{ "title": string, "area": string, "detail": string, "priority": "high" | "medium" | "low" }], "keyReads": string[] }';

const STRATEGY_SHAPE =
  '{ "headline": string, "summary": string, ' +
  '"contentStrategy": [{ "pillar": string, "detail": string, "evidence": string }], ' +
  '"gtmTactics": [{ "tactic": string, "detail": string, "timing": string, "evidence": string }], ' +
  '"contentFormats": [{ "format": string, "purpose": string, "where": string, "evidence": string }], ' +
  '"channels": [{ "channel": string, "type": "earned" | "owned" | "paid" | "shared" | "retail", "role": string, "priority": "high" | "medium" | "low", "evidence": string }], ' +
  '"mediaRelations": [{ "target": string, "angle": string, "asset": string, "evidence": string }], ' +
  '"investment": [{ "area": string, "priority": "high" | "medium" | "low", "share": number, "rationale": string }], ' +
  '"kpis": [{ "metric": string, "baseline": string, "target": string, "timeframe": string }], ' +
  '"roadmap": [{ "phase": string, "timing": string, "actions": string[] }], "personaLinks": string[] }';

/** What the study says about one market: the brief, and that market's personas and their answers. */
async function studyContext(projectId: string, market: string | null): Promise<string[]> {
  const [brief, report] = await Promise.all([latestBrief(projectId), loadReport(projectId)]);
  const out: string[] = [];
  if (brief?.businessContext) out.push(`Brand and category context: ${brief.businessContext.slice(0, 1200)}`);
  if (brief?.objective) out.push(`Objective: ${brief.objective}`);
  if (brief?.targetAudience) out.push(`Target audience: ${brief.targetAudience}`);
  if (report) {
    out.push(`Roundtable question: ${report.roundtable.question}`);
    const cast = report.cast.filter((p) => !market || p.profile.market === market);
    for (const p of cast.slice(0, 9)) {
      const a = p.answer;
      out.push(`Persona ${p.name} (${p.profile.market}, ${segmentLine(p.profile)})${a ? `: openness ${Math.round(a.overall ?? 0)}/100; “${a.quote}”` : ''}${a?.profile?.howToReach.length ? `; reach via ${a.profile.howToReach.join('; ')}` : ''}${a?.barriers.length ? `; barriers: ${a.barriers.slice(0, 2).join('; ')}` : ''}`);
    }
    if (report.summary?.comms?.headline) out.push(`Communications recommendation (report): ${report.summary.comms.headline}`);
  }
  return out;
}

export async function executeGeoAudit(adviceId: string): Promise<{ adviceId: string; status: string; reason?: string }> {
  const advice = await prisma.advice.findUnique({ where: { id: adviceId } });
  if (!advice) throw new Error(`GEO audit ${adviceId} does not exist.`);
  if (advice.status === 'COMPLETED') return { adviceId, status: 'COMPLETED' };
  await prisma.advice.update({ where: { id: adviceId }, data: { status: 'RUNNING', failureReason: null } });
  const opts = advice.options as unknown as GeoOptions;
  const lang: Lang = opts.language === 'zh' ? 'zh' : 'en';
  const write = lang === 'zh' ? 'Write every text value in Simplified Chinese; keep brand names, domains, engine names and figures as they are.' : 'Write every text value in English.';
  try {
    const bytes = await storage().get(opts.storageKey);
    const file = await readBriefFile(bytes, opts.fileName);
    if (!file.attachments.length && file.text.replace(/\s/g, '').length < 20) throw new GeoFailed('No readable content was found in this file. Upload the GEO audit as a PDF, PowerPoint, Excel or Word file.');
    const markets = await availableMarkets(advice.projectId);

    // 1 — the metrics, as reported.
    const m = await callModel({
      adviceId,
      stage: 'GEO_METRICS',
      personaKey: 'geo-reader',
      system: [
        'You are a GEO (generative engine optimisation) analyst. You read an AI visibility audit — how AI answer engines name and cite a',
        'brand against its competitors — and record its figures exactly as reported. You extract; you do not estimate or invent.',
        '',
        'Rules:',
        '1. Percentages are numbers without the % sign (28.3, not "28.3%"). A figure the report does not give is null.',
        '2. "headline": the brand\'s overall non-branded visibility, mentions rate, citation share, average ranking, its rank and the number of brands tracked, market share of tracked-brand mentions, and branded visibility.',
        '3. "competitors": every tracked brand including the audited brand, with its mentions rate (and visibility on non-branded and branded prompts where given).',
        '4. "topicScores": for every topic, the audited brand\'s figure and the brand that leads that topic with its figure.',
        '5. "engineScores": the brand\'s mentions by AI engine. "sourceTypes": the citation mix by source type. "industrySources" and "brandedSources": the top cited domains. "ownedDomains": brand-owned domains with share and rank. "topPages": the most-cited brand pages.',
        '6. "market": the country or region the audit measures. If the report does not state it, infer it from retailers, domains (e.g. /eu/en, .co.uk), currencies or language, set "marketBasis" to "inferred" and give the clues in "marketEvidence".',
        '7. "recommendations": the report\'s own recommendations, with area (PR, content, category, retail, technical…) and priority. "keyReads": each slide\'s main read, one line each.',
        `8. ${write}`,
        '9. Reply with a single JSON object in the shape you are given. No prose outside it.',
      ].join('\n'),
      attachments: file.attachments,
      messages: [{
        role: 'user',
        content: [
          `FILE NAME: ${opts.fileName}`,
          `MARKETS IN THE STUDY: ${markets.join(' | ') || '(none yet)'}`,
          file.attachments.length ? 'The audit is the attached file.' : wrapUntrusted('GEO audit', file.text.slice(0, 100_000)),
          '',
          `Respond with JSON: ${METRICS_SHAPE}`,
        ].join('\n'),
      }],
      schemaName: 'geo_metrics',
      schema: GeoMetrics,
      seed: deriveSeed(1, 'geo_metrics', adviceId),
      budgetCapUsd: env().AI_RUN_BUDGET_USD,
      maxTokens: 12000,
      promptTemplate: 'geo.metrics',
      promptVersion: GEO_PROMPT_VERSION,
    });
    if (!m.ok || !m.value) throw new GeoFailed(`The GEO audit could not be read (${m.outcome}). Try again, or upload it as a PDF.`);
    const metrics = m.value;
    const analysis = analyseGeo(metrics);
    const matchedMarket = metrics.market ? (markets.find((x) => x.toLowerCase() === metrics.market.toLowerCase()) ?? marketsMentioned(metrics.market, markets)[0] ?? null) : null;
    const study = await studyContext(advice.projectId, matchedMarket);

    // 2 — the GEO communication strategy for that market.
    const s = await callModel({
      adviceId,
      stage: 'GEO_STRATEGY',
      personaKey: 'geo-strategist',
      system: [
        'You are a senior PR and communications strategist specialising in GEO: making a brand the answer AI engines give and cite.',
        'From an AI visibility audit and a consumer study of the same market, write the GEO part of the brand\'s communication strategy',
        'for entering or growing in that market. Every recommendation must follow from a figure in the audit (quote it in "evidence").',
        '',
        'How to read the audit:',
        '- Topics within reach of the leader are where effort converts fastest; topics where the brand is absent need category entry, not optimisation.',
        '- A wide gap between mentions and citations means engines know the brand but do not trust its pages: publish citable owned content (explainers, comparisons, spec tables, FAQs, structured data, llms.txt).',
        '- The source-type mix shows which channels decide AI answers: review and tech media → earned media and review programmes; retail and price comparison → retail listings and syndicated reviews; video and social → creator content; forums → community seeding; brand sites → owned content.',
        '- The most-cited industry domains are the media relations targets; the competitors\' most-cited pages show the content formats that win.',
        '- Engines that lag rely on different sources (retrieval-heavy engines lean on retailer and review pages).',
        '- Use the study\'s personas for that market (how to reach them, their barriers) to shape messages and channels; say where you do.',
        '',
        'Rules:',
        '1. contentStrategy: 3–5 pillars. gtmTactics: 4–6. contentFormats: 4–6, each with where it should live. channels: 5–8, typed earned/owned/paid/shared/retail, with priority.',
        '2. mediaRelations: named outlets or domains from the audit, the angle and the asset to offer. investment: where to invest, with a priority and an indicative share of the GEO budget (shares add to 100).',
        '3. kpis: from the audit\'s own metrics, with baseline (the current figure) and a target. roadmap: 3 phases (first 30 days, 90 days, 6 months).',
        `4. ${write}`,
        '5. Reply with a single JSON object in the shape you are given. No prose outside it.',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: [
          `BRAND: ${metrics.brand} · MARKET: ${metrics.market || 'not stated'}${matchedMarket ? ` (study market: ${matchedMarket})` : ' (not among the study markets)'} · PERIOD: ${metrics.period}`,
          '',
          '## What the audit\'s figures mean (computed in code)',
          ...analysis.facts.map((f) => `- ${f}`),
          '',
          '## The audit, as read',
          wrapUntrusted('GEO audit metrics', JSON.stringify(metrics).slice(0, 30_000)),
          '',
          '## The consumer study for this market',
          study.length ? wrapUntrusted('study context', study.join('\n')) : '(no study data for this market yet)',
          '',
          `Respond with JSON: ${STRATEGY_SHAPE}`,
        ].join('\n'),
      }],
      schemaName: 'geo_strategy',
      schema: GeoStrategy,
      seed: deriveSeed(1, 'geo_strategy', adviceId),
      budgetCapUsd: env().AI_RUN_BUDGET_USD,
      maxTokens: 10000,
      promptTemplate: 'geo.strategy',
      promptVersion: GEO_PROMPT_VERSION,
    });
    if (!s.ok || !s.value) throw new GeoFailed(`The GEO strategy could not be written (${s.outcome}). Try again.`);
    const content: GeoContent = { metrics, analysis, strategy: s.value, matchedMarket };
    const spend = await prisma.modelCall.aggregate({ where: { adviceId }, _sum: { costUsd: true } });
    await prisma.advice.update({ where: { id: adviceId }, data: { status: 'COMPLETED', content: content as unknown as object, isMock: m.isMock, spendUsd: spend._sum.costUsd ?? 0, completedAt: new Date() } });
    return { adviceId, status: 'COMPLETED' };
  } catch (e) {
    const reason = e instanceof GeoFailed || e instanceof JourneyRefused ? e.message : 'The GEO audit could not be read. The failure has been recorded.';
    if (!(e instanceof GeoFailed)) console.error('[geo audit] failed', e);
    await prisma.advice.update({ where: { id: adviceId }, data: { status: 'FAILED', failureReason: reason } });
    return { adviceId, status: 'FAILED', reason };
  }
}

// ── Evidence for the plan writer, the creative brief and the context API ──────

/** One line per finding, for prompts that cite numbered evidence. */
export function geoEvidenceLines(a: GeoContent): string[] {
  const m = a.metrics;
  const s = a.strategy;
  const where = `${m.brand} in ${m.market || 'the audited market'}${m.period ? ` (${m.period})` : ''}`;
  return [
    `GEO audit — ${where}: ${a.analysis.facts.join(' ')}`,
    m.recommendations.length ? `GEO audit recommendations — ${where}: ${m.recommendations.map((r) => `${r.title} [${r.area}, ${r.priority}]`).join('; ')}` : '',
    s.headline ? `GEO strategy — ${where}: ${s.headline}` : '',
    s.channels.length ? `GEO channels — ${where}: ${s.channels.map((c) => `${c.channel} (${c.type}, ${c.priority}): ${c.role}`).join('; ')}` : '',
    s.contentFormats.length ? `GEO content formats — ${where}: ${s.contentFormats.map((f) => `${f.format} on ${f.where}`).join('; ')}` : '',
    s.mediaRelations.length ? `GEO media relations targets — ${where}: ${s.mediaRelations.map((r) => `${r.target} (${r.angle})`).join('; ')}` : '',
    s.investment.length ? `GEO investment — ${where}: ${s.investment.map((i) => `${i.area} ${i.share ?? '—'}% (${i.priority})`).join('; ')}` : '',
  ].filter(Boolean);
}
