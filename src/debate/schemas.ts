/**
 * The shapes every debate answer must satisfy.
 *
 * As in a simulation run, an answer that does not fit is repaired once and then recorded as invalid;
 * it never becomes part of the debate. Evidence is cited by id (`E12`), never by restating a figure,
 * so the engine can check every citation against what the swarm was actually shown.
 */
import { z } from 'zod';

export const DEBATE_STANCES = ['support', 'oppose', 'undecided'] as const;
export type DebateStance = (typeof DEBATE_STANCES)[number];

const evidenceIds = z.array(z.string().max(12)).max(12).default([]);

/** Moderator, before anyone speaks: what exactly is being decided, and how. */
export const DebateFraming = z.object({
  motion: z.string().min(1).max(600),
  subQuestions: z.array(z.string().max(300)).max(6).default([]),
  decisionCriteria: z.array(z.string().max(300)).max(6).default([]),
  groundRules: z.array(z.string().max(300)).max(6).default([]),
});
export type DebateFraming = z.infer<typeof DebateFraming>;

/** Each persona agent, alone: nobody has seen another view yet. */
export const DebateOpening = z.object({
  stance: z.enum(DEBATE_STANCES),
  confidence: z.number().min(0).max(1),
  argument: z.string().min(1).max(2500),
  keyPoints: z.array(z.string().max(400)).max(5).default([]),
  evidenceIds,
  whatWouldChangeMyMind: z.string().max(600).optional(),
});
export type DebateOpening = z.infer<typeof DebateOpening>;

/** Evidence analyst: which claims the evidence carries and which it does not. */
export const EvidenceReview = z.object({
  summary: z.string().min(1).max(1500),
  unsupportedClaims: z
    .array(z.object({ agentKey: z.string().max(60), claim: z.string().max(500), reason: z.string().max(500) }))
    .max(12)
    .default([]),
  strongestEvidenceIds: evidenceIds,
  evidenceGaps: z.array(z.string().max(400)).max(6).default([]),
});
export type EvidenceReview = z.infer<typeof EvidenceReview>;

/** Moderator, each round: the focus, and who is handed the floor to answer whom. */
export const ModeratorHandoff = z.object({
  focus: z.string().min(1).max(600),
  handoffs: z
    .array(z.object({ agentKey: z.string().max(60), respondTo: z.string().max(60), prompt: z.string().max(600) }))
    .max(8)
    .default([]),
});
export type ModeratorHandoff = z.infer<typeof ModeratorHandoff>;

/** A persona agent answering a named argument. Conceding is allowed and recorded. */
export const DebateRebuttal = z.object({
  respondsTo: z.string().max(60),
  rebuttal: z.string().min(1).max(2500),
  concedes: z.boolean(),
  stance: z.enum(DEBATE_STANCES),
  confidence: z.number().min(0).max(1),
  evidenceIds,
});
export type DebateRebuttal = z.infer<typeof DebateRebuttal>;

/** Devil's advocate: the strongest case against whatever the panel currently leans towards. */
export const DevilChallenge = z.object({
  challenge: z.string().min(1).max(2500),
  alternativeExplanation: z.string().max(1500).optional(),
  evidenceIds,
  severity: z.enum(['minor', 'material', 'fundamental']),
});
export type DevilChallenge = z.infer<typeof DevilChallenge>;

/** Each persona agent's final position, and whether and why it moved. */
export const DebateClosing = z.object({
  stance: z.enum(DEBATE_STANCES),
  confidence: z.number().min(0).max(1),
  changed: z.boolean(),
  reason: z.string().min(1).max(1500),
  finalArgument: z.string().min(1).max(2000),
  evidenceIds,
});
export type DebateClosing = z.infer<typeof DebateClosing>;

/** The judge's reference conclusion. Dissent and evidence gaps are required, not optional extras. */
export const DebateVerdict = z.object({
  answer: z.enum(['supported', 'not_supported', 'mixed', 'insufficient_evidence']),
  conclusion: z.string().min(1).max(2500),
  confidence: z.enum(['high', 'medium', 'low']),
  segmentFindings: z
    .array(z.object({ segment: z.string().max(120), assessment: z.string().max(800), evidenceIds }))
    .max(8)
    .default([]),
  argumentsFor: z.array(z.string().max(500)).max(6).default([]),
  argumentsAgainst: z.array(z.string().max(500)).max(6).default([]),
  consensus: z.array(z.string().max(500)).max(6).default([]),
  dissent: z.array(z.string().max(500)).max(6).default([]),
  evidenceGaps: z.array(z.string().max(500)).max(6).default([]),
  recommendations: z.array(z.string().max(500)).max(6).default([]),
});
export type DebateVerdict = z.infer<typeof DebateVerdict>;
