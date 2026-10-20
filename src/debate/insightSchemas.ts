/**
 * The shapes of what is made from a completed debate.
 *
 * As everywhere else, evidence is cited by id and checked against what the agent was shown; an
 * answer that does not fit is repaired once and then recorded as a failure.
 */
import { z } from 'zod';

const evidenceIds = z.array(z.string().max(12)).max(12).default([]);

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
  answer: z.string().min(1).max(2000),
  categories: z
    .array(
      z.object({
        category: z.string().min(1).max(80),
        likelihood: z.enum(LIKELIHOODS),
        reason: z.string().max(500),
        evidenceIds,
      }),
    )
    .max(16)
    .default([]),
  conditions: z.array(z.string().max(300)).max(6).default([]),
  barriers: z.array(z.string().max(300)).max(6).default([]),
  confidence: z.number().min(0).max(1),
});
export type PanelAnswer = z.infer<typeof PanelAnswer>;

/** A market-entry public relations and communications strategy, from the focus group. */
export const CommsReport = z.object({
  title: z.string().min(1).max(200),
  executiveSummary: z.string().min(1).max(3000),
  situation: z.string().max(2500),
  objectives: z.array(z.string().max(400)).max(6).default([]),
  audienceInsights: z
    .array(z.object({ segment: z.string().max(160), insight: z.string().max(800), implication: z.string().max(800), evidenceIds }))
    .max(10)
    .default([]),
  positioning: z.string().max(1500),
  keyMessages: z
    .array(z.object({ message: z.string().max(400), audience: z.string().max(200), proofPoints: z.array(z.string().max(300)).max(4).default([]) }))
    .max(8)
    .default([]),
  channels: z
    .array(z.object({ channel: z.string().max(120), role: z.string().max(400), rationale: z.string().max(600) }))
    .max(10)
    .default([]),
  voices: z.array(z.object({ voice: z.string().max(160), why: z.string().max(500) })).max(8).default([]),
  phasedPlan: z
    .array(z.object({ phase: z.string().max(120), timing: z.string().max(120), objective: z.string().max(400), activities: z.array(z.string().max(300)).max(6).default([]) }))
    .max(6)
    .default([]),
  risks: z
    .array(z.object({ risk: z.string().max(400), likelihood: z.enum(['high', 'medium', 'low']), mitigation: z.string().max(600) }))
    .max(10)
    .default([]),
  kpis: z.array(z.object({ kpi: z.string().max(200), target: z.string().max(200), measurement: z.string().max(300) })).max(10).default([]),
  limitations: z.array(z.string().max(500)).max(6).default([]),
});
export type CommsReport = z.infer<typeof CommsReport>;

/** A persona agent introducing itself, in the first person. */
export const SelfIntro = z.object({
  headline: z.string().min(1).max(160),
  introduction: z.string().min(1).max(2000),
  aboutMe: z.array(z.string().max(300)).max(6).default([]),
  whatIValue: z.array(z.string().max(300)).max(6).default([]),
  viewOnTheTopic: z.string().max(1200),
  howToReachMe: z.array(z.string().max(300)).max(5).default([]),
  evidenceIds,
});
export type SelfIntro = z.infer<typeof SelfIntro>;

/** A persona agent answering one strategist question. */
export const InterviewAnswer = z.object({
  answer: z.string().min(1).max(2500),
  confidence: z.number().min(0).max(1),
  evidenceIds,
  outsideEvidence: z.boolean().default(false),
});
export type InterviewAnswer = z.infer<typeof InterviewAnswer>;
