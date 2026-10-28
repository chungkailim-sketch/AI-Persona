/**
 * The shapes of what the cast and the roundtable produce. Lenient in the same way as the debate
 * insights: an answer that runs long or writes "72%" for 72 is trimmed and normalised, not refused.
 */
import { z } from 'zod';
import { list, strings, text, toText } from '@/debate/insightSchemas';

/** A 0–100 score from whatever the model wrote ("72", "72%", 72.4). Unreadable → null. */
const score = z.preprocess((v) => {
  const n = typeof v === 'string' ? Number(v.replace(/[%\s]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : null;
}, z.number().nullable());

const age = z.preprocess((v) => {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(85, Math.max(18, n))) : 35;
}, z.number());

/** The illustrative identity written onto a cast card. */
export const CastIdentity = z
  .object({
    name: text(60),
    age,
    gender: text(30),
    occupation: text(80),
    city: text(60),
    lifeStage: text(80),
    decisionLogic: strings(3, 40),
    keyStatIds: strings(3, 6),
    oneLiner: text(200),
  })
  .refine((r) => r.name.length > 0, { message: 'No name.' });
export type CastIdentity = z.infer<typeof CastIdentity>;

export const RoundtableAnswerShape = z
  .object({
    quote: text(400),
    scores: list(z.object({ category: text(80), score, reason: text(400) }), 16).transform((a) => a.filter((c) => c.category && c.score !== null)),
    conditions: strings(5, 300),
    barriers: strings(5, 300),
    profile: z.preprocess(
      (v) => (v && typeof v === 'object' ? v : {}),
      z.object({
        mindset: list(z.object({ label: text(40), value: text(60) }), 4).transform((a) => a.filter((m) => m.label)),
        howToReach: strings(4, 200),
        holdsBack: strings(4, 200),
        commsAdvice: strings(4, 300),
      }),
    ),
  })
  .refine((r) => r.scores.length > 0, { message: 'No category was scored.' });
export type RoundtableAnswerShape = z.infer<typeof RoundtableAnswerShape>;

export const RoundtableSummary = z
  .object({
    consensus: text(400),
    takeaways: strings(5, 400),
    comms: z.preprocess(
      (v) => (v && typeof v === 'object' ? v : {}),
      z.object({
        headline: text(300),
        pillars: list(z.object({ title: text(80), detail: text(500) }), 4).transform((a) => a.filter((p) => p.title)),
        byMarket: list(z.object({ market: text(60), message: text(400), channels: strings(4, 80) }), 16).transform((a) => a.filter((m) => m.market)),
      }),
    ),
    marketReading: z.preprocess(
      (v) => (v && typeof v === 'object' ? v : {}),
      z.object({ potential: strings(4, 400), entry: strings(4, 400), strategy: strings(4, 400) }),
    ),
  })
  .refine((r) => r.consensus.length > 0 || r.takeaways.length > 0, { message: 'Empty summary.' });
export type RoundtableSummary = z.infer<typeof RoundtableSummary>;

export { toText };
