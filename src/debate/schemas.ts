/**
 * The shapes every debate answer must satisfy.
 *
 * Lenient in form, strict in substance: an answer that runs long, lists too many items, writes
 * "80%" for 0.8 or "Support" for support is trimmed and normalised, not refused — a long debate in
 * any language should not lose a turn to formatting. An answer whose core content is missing is
 * still repaired once and then recorded as invalid; it never becomes part of the debate. Evidence is cited by id (`E12`), never by restating a figure,
 * so the engine can check every citation against what the swarm was actually shown.
 */
import { z } from 'zod';
import { list, oneOf, strings, text, toText } from './insightSchemas';

export const DEBATE_STANCES = ['support', 'oppose', 'undecided'] as const;
export type DebateStance = (typeof DEBATE_STANCES)[number];

const evidenceIds = strings(12, 12);
/** Required text: trimmed to `max`, refused only when empty. */
const required = (max: number) => text(max).refine((v) => v.length > 0, { message: 'Empty.' });
const optional = (max: number) => text(max).transform((v) => v || undefined);

const STANCE_WORDS: [DebateStance, RegExp][] = [
  ['support', /^(support|agree|for|pro|yes|in favou?r|支持|赞成|同意)/i],
  ['oppose', /^(oppos|disagree|against|con\b|no\b|反对|不支持|不同意)/i],
];
const stance = z.preprocess((v) => {
  const t = toText(v).trim();
  return STANCE_WORDS.find(([, re]) => re.test(t))?.[0] ?? 'undecided';
}, z.enum(DEBATE_STANCES));

/** A confidence from 0 to 1, however it was written: 0.8, 80, "80%", "0.8". Unreadable → 0.5. */
const unit = z.preprocess((v) => {
  const n = typeof v === 'string' ? Number(v.replace(/[%\s]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n > 1 ? n / 100 : n)) : 0.5;
}, z.number());

const flag = z.preprocess((v) => (typeof v === 'string' ? /^(true|yes|y|1|是|对)$/i.test(v.trim()) : Boolean(v)), z.boolean());

/** Moderator, before anyone speaks: what exactly is being decided, and how. */
export const DebateFraming = z.object({
  motion: required(600),
  subQuestions: strings(6, 300),
  decisionCriteria: strings(6, 300),
  groundRules: strings(6, 300),
});
export type DebateFraming = z.infer<typeof DebateFraming>;

/** Each persona agent, alone: nobody has seen another view yet. */
export const DebateOpening = z.object({
  stance,
  confidence: unit,
  argument: required(2500),
  keyPoints: strings(5, 400),
  evidenceIds,
  whatWouldChangeMyMind: optional(600),
});
export type DebateOpening = z.infer<typeof DebateOpening>;

/** Evidence analyst: which claims the evidence carries and which it does not. */
export const EvidenceReview = z.object({
  summary: required(1500),
  unsupportedClaims: list(z.object({ agentKey: text(60), claim: text(500), reason: text(500) }), 12),
  strongestEvidenceIds: evidenceIds,
  evidenceGaps: strings(6, 400),
});
export type EvidenceReview = z.infer<typeof EvidenceReview>;

/** Moderator, each round: the focus, and who is handed the floor to answer whom. */
export const ModeratorHandoff = z.object({
  focus: required(600),
  // More hand-offs than a round allows are cut to the limit by the engine, not refused here.
  handoffs: list(z.object({ agentKey: text(60), respondTo: text(60), prompt: text(600) }), 24).transform((a) => a.filter((h) => h.agentKey)),
});
export type ModeratorHandoff = z.infer<typeof ModeratorHandoff>;

/** A persona agent answering a named argument. Conceding is allowed and recorded. */
export const DebateRebuttal = z.object({
  respondsTo: text(60),
  rebuttal: required(2500),
  concedes: flag,
  stance,
  confidence: unit,
  evidenceIds,
});
export type DebateRebuttal = z.infer<typeof DebateRebuttal>;

/** Devil's advocate: the strongest case against whatever the panel currently leans towards. */
export const DevilChallenge = z.object({
  challenge: required(2500),
  alternativeExplanation: optional(1500),
  evidenceIds,
  severity: oneOf(['minor', 'material', 'fundamental'] as const, 'material'),
});
export type DevilChallenge = z.infer<typeof DevilChallenge>;

/** Each persona agent's final position, and whether and why it moved. */
export const DebateClosing = z.object({
  stance,
  confidence: unit,
  changed: flag,
  reason: required(1500),
  finalArgument: required(2000),
  evidenceIds,
});
export type DebateClosing = z.infer<typeof DebateClosing>;

/** The judge's reference conclusion. Dissent and evidence gaps are required, not optional extras. */
export const DebateVerdict = z.object({
  // Always the closest conclusion the data, related findings and external sources point to.
  answer: oneOf(['supported', 'not_supported', 'mixed'] as const, 'mixed'),
  conclusion: required(2500),
  /** What the conclusion rests on: figures that address the motion, related figures, or outside sources. */
  basis: oneOf(['direct', 'inferred', 'external'] as const, 'inferred'),
  /** Each step of inference, stated so a reader can see what was measured and what was reasoned. */
  inferences: strings(8, 500),
  segmentFindings: list(z.object({ segment: text(120), assessment: text(800), evidenceIds }), 8),
  argumentsFor: strings(6, 500),
  argumentsAgainst: strings(6, 500),
  consensus: strings(6, 500),
  dissent: strings(6, 500),
  evidenceGaps: strings(6, 500),
  recommendations: strings(6, 500),
});
export type DebateVerdict = z.infer<typeof DebateVerdict>;

/** Published data points found on the web for a motion the project's own data only partly covers. */
export const DebateResearch = z.object({
  findings: list(z.object({ claim: text(600), source: text(200), url: text(500), year: text(12) }), 10).transform((a) => a.filter((f) => f.claim && /^https?:\/\//.test(f.url))),
});
export type DebateResearch = z.infer<typeof DebateResearch>;
