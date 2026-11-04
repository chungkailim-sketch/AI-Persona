/**
 * OpenAI Decisions API (POST /v1/decisions, model gpt-6-luna) — server only.
 *
 * A request is one shared `input` and a set of `questions`, each a predicate (probability that a
 * statement is true), a choice (one of 2–255 values, with a probability for each) or a score (an
 * expected position on 2–10 ordered levels). The reply is an `answers` array in question order.
 *
 * Request and reply follow the official guide (developers.openai.com/api/docs/guides/decisions):
 * questions carry a unique `name`, echoed on each answer; choice and score answers return
 * `probabilities` as [{ value, probability }] (score entries also carry the level `label`) and a
 * `confidence`; an answer of type "refusal" means the model declined that question. The reply is
 * still read leniently (matched by name, then position). Without a key, a deterministic local
 * stand-in answers and every answer says so.
 */
import { createHash } from 'node:crypto';
import { decisionsConfigured, env } from '@/lib/env';

export type DecisionQuestion =
  | { name: string; type: 'predicate'; instructions: string }
  | { name: string; type: 'choice'; instructions: string; choices: { value: string; description?: string }[] }
  | { name: string; type: 'score'; instructions: string; levels: { label: string; description?: string }[] };

export interface DecisionAnswer {
  name: string;
  type: DecisionQuestion['type'];
  /** predicate: probability the statement is true, 0–1 */
  probability?: number;
  /** choice: the chosen value */
  choice?: string;
  /** choice: probability per value; score: probability per level label */
  probabilities?: Record<string, number>;
  /** score: expected zero-based level index (may be fractional) */
  score?: number;
  confidence?: number;
  /** The model declined to answer this question. */
  refused?: boolean;
}

export interface DecisionResult {
  answers: DecisionAnswer[];
  isMock: boolean;
  modelId: string;
}

export class DecisionFailed extends Error {}

const MAX_INPUT = 24_000;
const TIMEOUT_MS = 30_000;

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** Probabilities given as an object, as [{ value, probability }], or as an array in order. */
function probabilityMap(raw: unknown, keys: string[]): Record<string, number> | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    const out: Record<string, number> = {};
    raw.forEach((x, i) => {
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        // Score levels come back as { value: index, label }; key them by label.
        const k = String(o.label ?? o.value ?? o.choice ?? keys[i] ?? i);
        const p = num(o.probability ?? o.p);
        if (p !== undefined) out[k] = p;
      } else if (num(x) !== undefined && keys[i] !== undefined) out[keys[i]!] = num(x)!;
    });
    return Object.keys(out).length ? out : undefined;
  }
  if (typeof raw === 'object') {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (num(v) !== undefined) out[k] = num(v)!;
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

/** Read the reply into one answer per question, whatever spelling the fields use. */
export function parseDecisionResponse(body: unknown, questions: DecisionQuestion[]): DecisionAnswer[] {
  const root = (body ?? {}) as Record<string, unknown>;
  const list = (Array.isArray(root.answers) ? root.answers : Array.isArray(root.results) ? root.results : Array.isArray(root.output) ? root.output : []) as Record<string, unknown>[];
  return questions.map((q, i) => {
    const a = list.find((x) => x && (x.name === q.name || x.question === q.name || x.id === q.name)) ?? list[i] ?? {};
    const inner = (a.answer && typeof a.answer === 'object' ? a.answer : a) as Record<string, unknown>;
    const out: DecisionAnswer = { name: q.name, type: q.type, confidence: num(inner.confidence ?? a.confidence) };
    if (a.type === 'refusal') return { ...out, refused: true };
    if (q.type === 'predicate') {
      out.probability = num(inner.probability ?? inner.p ?? inner.probability_true ?? (typeof inner.answer === 'number' ? inner.answer : undefined));
      if (out.probability === undefined && typeof (inner.answer ?? inner.value) === 'boolean') out.probability = (inner.answer ?? inner.value) ? 1 : 0;
    } else if (q.type === 'choice') {
      const keys = q.choices.map((c) => c.value);
      out.probabilities = probabilityMap(inner.probabilities ?? inner.distribution, keys);
      const c = inner.choice ?? inner.value ?? (typeof inner.answer === 'string' ? inner.answer : undefined);
      out.choice = c !== undefined ? String(c) : out.probabilities ? Object.entries(out.probabilities).sort((x, y) => y[1] - x[1])[0]?.[0] : undefined;
    } else {
      const keys = q.levels.map((l) => l.label);
      out.score = num(inner.score ?? inner.expected_score ?? inner.value);
      out.probabilities = probabilityMap(inner.probabilities ?? inner.distribution, keys);
    }
    return out;
  });
}

/** The local stand-in: deterministic in the input, so a page shows the same guidance on reload. */
function mockAnswers(input: string, questions: DecisionQuestion[]): DecisionAnswer[] {
  return questions.map((q) => {
    const h = createHash('sha256').update(`${q.name}\n${input}`).digest();
    const r = h[0]! / 255;
    if (q.type === 'predicate') return { name: q.name, type: q.type, probability: Math.round((0.45 + r * 0.45) * 100) / 100, confidence: 0.5 };
    if (q.type === 'choice') {
      const weights = q.choices.map((_, i) => 1 + (h[i + 1]! / 255) * (i === 0 ? 2 : 1));
      const total = weights.reduce((s, x) => s + x, 0);
      const probabilities = Object.fromEntries(q.choices.map((c, i) => [c.value, Math.round((weights[i]! / total) * 100) / 100]));
      const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
      return { name: q.name, type: q.type, choice, probabilities, confidence: 0.5 };
    }
    return { name: q.name, type: q.type, score: Math.round(r * (q.levels.length - 1) * 100) / 100, confidence: 0.5 };
  });
}

export async function decide(input: string, questions: DecisionQuestion[]): Promise<DecisionResult> {
  const e = env();
  const text = input.length > MAX_INPUT ? `${input.slice(0, MAX_INPUT)}\n[truncated]` : input;
  if (!decisionsConfigured(e)) return { answers: mockAnswers(text, questions), isMock: true, modelId: 'local-stand-in' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(e.DECISIONS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${e.OPENAI_API_KEY!.trim()}` },
      body: JSON.stringify({ model: e.DECISIONS_MODEL, input: text, questions }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // The body may echo the request; only the status and the provider's error type are kept.
      const detail = await res.json().catch(() => null) as { error?: { type?: string; code?: string; message?: string } } | null;
      const what = detail?.error?.code ?? detail?.error?.type ?? '';
      const message = detail?.error?.message ? `: ${detail.error.message.slice(0, 200)}` : '';
      throw new DecisionFailed(`The Decisions API answered ${res.status}${what ? ` (${what})` : ''}${message}`);
    }
    return { answers: parseDecisionResponse(await res.json(), questions), isMock: false, modelId: e.DECISIONS_MODEL };
  } catch (err) {
    if (err instanceof DecisionFailed) throw err;
    throw new DecisionFailed(controller.signal.aborted ? 'The Decisions API did not answer within 30 seconds.' : 'The Decisions API could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}
