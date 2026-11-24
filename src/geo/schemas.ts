/**
 * The shapes of a GEO (generative engine optimisation) audit: what is read out of an uploaded AI
 * visibility audit, and the communication strategy written from it.
 *
 * Lenient like every model-facing schema in the app: a figure written as "28.3%" or "#2" is read as a
 * number, a missing figure is null, an over-long list is trimmed.
 */
import { z } from 'zod';
import { list, oneOf, strings, text } from '@/debate/insightSchemas';

/** A figure: "28.3%", "28.3", "#2", "-15.1pp" → number; blank or unreadable → null. */
export const num = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(String(v).replace(/,(?=\d{3}\b)/g, ''));
  return m ? Number(m[0].replace(',', '.')) : null;
}, z.number().nullable());

const obj = <T extends z.ZodRawShape>(shape: T) => z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), z.object(shape));
const priority = oneOf(['high', 'medium', 'low'] as const, 'medium');

export const GeoMetrics = z.object({
  brand: text(80),
  reportTitle: text(160),
  period: text(80),
  /** The market the audit measures: stated in the report, or inferred from its retailers, domains and language. */
  market: text(80),
  marketBasis: oneOf(['stated', 'inferred'] as const, 'inferred'),
  marketEvidence: text(400),
  engines: num,
  topics: num,
  headline: obj({
    visibility: num,
    mentions: num,
    citationShare: num,
    avgRank: num,
    rank: num,
    brandsTracked: num,
    marketShare: num,
    brandedVisibility: num,
  }),
  competitors: list(obj({ name: text(60), mentions: num, visibility: num, brandedVisibility: num }), 12).transform((a) => a.filter((c) => c.name)),
  topicScores: list(obj({ topic: text(80), brand: num, leader: text(60), leaderScore: num }), 20).transform((a) => a.filter((t) => t.topic)),
  engineScores: list(obj({ engine: text(60), mentions: num }), 10).transform((a) => a.filter((e) => e.engine)),
  sourceTypes: list(obj({ type: text(60), share: num }), 10).transform((a) => a.filter((s) => s.type)),
  industrySources: list(obj({ domain: text(80), share: num, citations: text(20) }), 15).transform((a) => a.filter((s) => s.domain)),
  brandedSources: list(obj({ domain: text(80), share: num }), 15).transform((a) => a.filter((s) => s.domain)),
  ownedDomains: list(obj({ brand: text(60), domain: text(80), share: num, rank: num }), 10).transform((a) => a.filter((s) => s.domain)),
  topPages: list(obj({ page: text(160), brand: text(60), note: text(200) }), 10).transform((a) => a.filter((s) => s.page)),
  battlegrounds: list(obj({ name: text(80), topics: text(200), position: text(200), keyDomains: strings(8, 60) }), 4).transform((a) => a.filter((b) => b.name)),
  trend: text(600),
  recommendations: list(obj({ title: text(160), area: text(40), detail: text(500), priority }), 12).transform((a) => a.filter((r) => r.title)),
  keyReads: strings(12, 500),
});
export type GeoMetrics = z.infer<typeof GeoMetrics>;

export const GeoStrategy = z.object({
  headline: text(300),
  summary: text(1500),
  contentStrategy: list(obj({ pillar: text(120), detail: text(500), evidence: text(300) }), 6).transform((a) => a.filter((x) => x.pillar)),
  gtmTactics: list(obj({ tactic: text(160), detail: text(500), timing: text(60), evidence: text(300) }), 8).transform((a) => a.filter((x) => x.tactic)),
  contentFormats: list(obj({ format: text(120), purpose: text(300), where: text(200), evidence: text(300) }), 8).transform((a) => a.filter((x) => x.format)),
  channels: list(obj({ channel: text(120), type: oneOf(['earned', 'owned', 'paid', 'shared', 'retail'] as const, 'earned'), role: text(300), priority, evidence: text(300) }), 10).transform((a) => a.filter((x) => x.channel)),
  mediaRelations: list(obj({ target: text(120), angle: text(300), asset: text(200), evidence: text(300) }), 10).transform((a) => a.filter((x) => x.target)),
  investment: list(obj({ area: text(120), priority, share: num, rationale: text(400) }), 8).transform((a) => a.filter((x) => x.area)),
  kpis: list(obj({ metric: text(120), baseline: text(60), target: text(60), timeframe: text(60) }), 8).transform((a) => a.filter((x) => x.metric)),
  roadmap: list(obj({ phase: text(80), timing: text(60), actions: strings(5, 300) }), 4).transform((a) => a.filter((x) => x.phase)),
  personaLinks: strings(6, 400),
});
export type GeoStrategy = z.infer<typeof GeoStrategy>;
