/**
 * The shapes a model answer must satisfy at each stage.
 *
 * Every model answer is parsed against one of these before it is used. An answer that does not fit
 * is retried once and then recorded as invalid — it never becomes a finding. This is what stops a
 * malformed or evasive answer from being silently interpreted into something the report treats as
 * a result.
 *
 * Note what is *not* here: no field asks for reasoning traces. What is stored is the position, the
 * confidence and the stated rationale — the things a reader can weigh.
 */
import { z } from 'zod';

export const STANCES = ['confirm', 'dispute', 'abstain'] as const;
export type Stance = (typeof STANCES)[number];

/** Stage 3: each persona answers alone, before seeing anyone else. */
export const IndependentAssessment = z.object({
  stance: z.enum(STANCES),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(4000),
  /** Field names from the evidence. Anything not in the evidence is dropped by the caller. */
  evidenceCited: z.array(z.string().max(200)).max(20).default([]),
  uncertainties: z.array(z.string().max(500)).max(10).default([]),
});
export type IndependentAssessment = z.infer<typeof IndependentAssessment>;

/** Stage 4: consumer personas react to the stimulus. */
export const ConsumerReaction = z.object({
  reaction: z.enum(['positive', 'mixed', 'negative']),
  intensity: z.number().min(0).max(1),
  verbatim: z.string().min(1).max(2000),
  drivers: z.array(z.string().max(300)).max(8).default([]),
  barriers: z.array(z.string().max(300)).max(8).default([]),
});
export type ConsumerReaction = z.infer<typeof ConsumerReaction>;

/** Stage 5: the challenge round. A challenge that targets nothing is not a challenge. */
export const CrossExamination = z.object({
  challenge: z.string().min(1).max(3000),
  targetsClaim: z.boolean(),
  alternativeExplanation: z.string().max(2000).optional(),
  severity: z.enum(['minor', 'material', 'fundamental']),
});
export type CrossExamination = z.infer<typeof CrossExamination>;

/** Stage 6: each persona revisits its position having seen the challenges. */
export const Revision = z.object({
  changed: z.boolean(),
  stance: z.enum(STANCES),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(3000),
});
export type Revision = z.infer<typeof Revision>;

/** Stage 7: the synthesis. Dissent is a required field, not an optional extra. */
export const SynthesisOutput = z.object({
  headline: z.string().min(1).max(1000),
  findings: z
    .array(
      z.object({
        claim: z.string().min(1).max(1500),
        support: z.enum(['strong', 'moderate', 'weak', 'none']),
        dissent: z.string().max(2000).optional(),
      }),
    )
    .max(20)
    .default([]),
  limitations: z.array(z.string().max(1000)).max(15).default([]),
});
export type SynthesisOutput = z.infer<typeof SynthesisOutput>;

export const SCHEMAS = {
  independent_assessment: IndependentAssessment,
  consumer_reaction: ConsumerReaction,
  cross_examination: CrossExamination,
  revision: Revision,
  synthesis: SynthesisOutput,
} as const;
