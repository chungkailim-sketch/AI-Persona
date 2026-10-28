/**
 * The shapes of what is made from a completed debate.
 *
 * As everywhere else, evidence is cited by id and checked against what the agent was shown; an
 * answer that does not fit is repaired once and then recorded as a failure.
 */
import { z } from 'zod';

/**
 * Lenient field types. A long report that runs a little over a length, returns seven items where
 * six were asked for, or writes "Medium" for "medium" is still a good report: it is trimmed and
 * normalised rather than thrown away. Only an answer with no usable shape at all is rejected.
 */
export const toText = (v: unknown): string =>
  v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(toText).join('; ') : typeof v === 'object' ? Object.values(v as object).map(toText).join(' — ') : String(v);
export const text = (max: number) => z.preprocess(toText, z.string()).transform((s) => s.trim().slice(0, max));
export const list = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(item)).transform((a) => a.slice(0, max));
export const strings = (max: number, each: number) => list(text(each), max).transform((a) => a.filter(Boolean));
export const unit = z.preprocess((v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n > 1 ? n / 100 : n)) : 0.5;
}, z.number());
export const oneOf = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.preprocess((v) => {
    const k = toText(v).trim().toLowerCase().replace(/[\s-]+/g, '_');
    return (values as readonly string[]).includes(k) ? k : fallback;
  }, z.enum(values));

const evidenceIds = strings(12, 12);

/** Product categories offered to the panel, so answers can be counted across personas. */
export const DEFAULT_CATEGORIES = [
  'Smartphones & consumer electronics',
  'Electric vehicles & cars',
  'Home appliances',
  'Beauty & personal care',
  'Fashion & apparel',
  'Food & beverage',
  'Online shopping platforms',
  'Gaming & entertainment apps',
  'Travel & hospitality',
  'Financial services & payments',
  'Health & wellness products',
  'Toys & hobbies',
] as const;

export const LIKELIHOODS = ['very_likely', 'likely', 'unlikely', 'would_not'] as const;
export type Likelihood = (typeof LIKELIHOODS)[number];

export const LIKELIHOOD_LABEL: Record<Likelihood, string> = {
  very_likely: 'Very likely',
  likely: 'Likely',
  unlikely: 'Unlikely',
  would_not: 'Would not',
};

/** One persona agent answering a question put to the whole panel. */
export const PanelAnswer = z.object({
  answer: text(3000),
  categories: list(
    z.object({
      category: text(80),
      likelihood: oneOf(LIKELIHOODS, 'unlikely'),
      reason: text(800),
      evidenceIds,
    }),
    20,
  ).transform((a) => a.filter((c) => c.category)),
  conditions: strings(8, 400),
  barriers: strings(8, 400),
  confidence: unit,
});
export type PanelAnswer = z.infer<typeof PanelAnswer>;

/** A market-entry public relations and communications strategy, from the focus group. */
export const CommsReport = z.object({
  title: text(200).transform((t) => t || 'Market entry communications strategy'),
  executiveSummary: text(5000),
  situation: text(4000),
  objectives: strings(8, 600),
  audienceInsights: list(z.object({ segment: text(200), insight: text(1200), implication: text(1200), evidenceIds }), 12),
  positioning: text(2500),
  keyMessages: list(z.object({ message: text(600), audience: text(300), proofPoints: strings(6, 500) }), 10),
  channels: list(z.object({ channel: text(200), role: text(600), rationale: text(900) }), 12),
  voices: list(z.object({ voice: text(200), why: text(800) }), 10),
  phasedPlan: list(z.object({ phase: text(200), timing: text(200), objective: text(600), activities: strings(8, 500) }), 8),
  risks: list(z.object({ risk: text(600), likelihood: oneOf(['high', 'medium', 'low'] as const, 'medium'), mitigation: text(900) }), 12),
  kpis: list(z.object({ kpi: text(300), target: text(300), measurement: text(500) }), 12),
  limitations: strings(8, 800),
}).refine((r) => r.executiveSummary.length > 0, { message: 'The report has no executive summary.' });
export type CommsReport = z.infer<typeof CommsReport>;

/** A persona agent introducing itself, in the first person. */
export const SelfIntro = z.object({
  headline: text(200),
  introduction: text(3000),
  aboutMe: strings(8, 500),
  whatIValue: strings(8, 500),
  viewOnTheTopic: text(2000),
  howToReachMe: strings(6, 500),
  evidenceIds,
}).refine((r) => r.introduction.length > 0, { message: 'No introduction.' });
export type SelfIntro = z.infer<typeof SelfIntro>;

/** A persona agent answering one strategist question. */
export const InterviewAnswer = z.object({
  answer: text(4000),
  confidence: unit,
  evidenceIds,
  outsideEvidence: z.preprocess((v) => v === true || v === 'true', z.boolean()),
}).refine((r) => r.answer.length > 0, { message: 'No answer.' });
export type InterviewAnswer = z.infer<typeof InterviewAnswer>;
