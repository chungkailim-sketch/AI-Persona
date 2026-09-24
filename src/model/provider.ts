/**
 * The model provider boundary.
 *
 * Everything the application knows about talking to a model goes through here, for three reasons
 * that each matter more than convenience:
 *
 *  1. **The key never leaves this module.** It is read from validated environment inside the
 *     provider, is not exported, is not placed on any object that gets serialised, and nothing
 *     under `app/` imports this file's Anthropic implementation directly.
 *  2. **Mock and live are never confusable.** Every response carries the provider that produced it,
 *     every `ModelCall` row records it, and every `Run` carries `isMock`. A mock result is labelled
 *     as mock everywhere it appears — it is decision support from a simulation either way, but a
 *     mock result is not even that.
 *  3. **Determinism is possible.** The mock provider is a seeded pseudo-random generator, so a run
 *     with the same plan hash and the same seeds produces the same output. That is what makes the
 *     orchestration testable without a network call and without a bill.
 *
 * Chain-of-thought is never requested and never stored. What is persisted is the structured answer
 * and the accounting; the model's intermediate reasoning is not evidence and keeping it invites it
 * being read as such.
 */
import { env } from '@/lib/env';

export type ProviderName = 'mock' | 'anthropic';

export interface ModelRequest {
  /** Which orchestration stage is asking. Recorded, and used by the mock to shape its answer. */
  stage: string;
  /** Identifies the speaking persona, for the audit trail. Never a real person's identifier. */
  personaKey?: string;
  system: string;
  /** Ordered turns. Untrusted material must already be wrapped by the caller. */
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** JSON shape the answer must satisfy. The provider asks for it; the caller validates it. */
  schemaName: string;
  seed?: number;
  maxTokens?: number;
  temperature?: number;
}

export interface ModelResponse {
  provider: ProviderName;
  modelId: string;
  /** Raw text of the answer. Parsed and validated by the caller, never trusted as-is. */
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  outcome: 'ok' | 'refused' | 'invalid' | 'timeout' | 'rate_limited' | 'error';
  /** Present only when the outcome is not ok. Never shown to the browser. */
  errorMessage?: string;
}

export interface ModelProvider {
  readonly name: ProviderName;
  readonly modelId: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/**
 * Published per-million-token prices, used for the pre-run estimate and the running total.
 *
 * These are a planning aid, not an invoice: prices change, and the authoritative figure is the
 * provider's own billing. The interface says so wherever a cost is shown.
 */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function estimateCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const price = PRICE_PER_MTOK[modelId] ?? PRICE_PER_MTOK['claude-sonnet-4-5']!;
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

/** Rough token count for estimation only. Four characters per token is the usual approximation. */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Deterministic pseudo-random source ───────────────────────────────────────

/**
 * A small, fast, well-distributed generator (mulberry32).
 *
 * `Math.random()` cannot be used anywhere in a run: the same plan and the same seed must produce
 * the same result, or a run cannot be reproduced and a disputed finding cannot be re-examined.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash, used to derive a per-persona seed from a run seed and a key. */
export function hashToInt(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * A per-persona, per-stage seed derived from the run seed.
 *
 * Two details that are not decoration:
 *
 *  - The parts are length-prefixed rather than joined by a separator. Any separator can occur
 *    inside a persona name, and then ["ab", "c"] and ["a", "bc"] hash to the same seed — two
 *    personas quietly sharing one, which is exactly what this must not do.
 *  - The result is shifted right one bit so it always fits a signed 32-bit integer. The seed is
 *    persisted on every `ModelCall`, and Postgres `Int` is signed: an unsigned 32-bit value
 *    overflows the column and the insert fails mid-run — far worse than losing one bit of entropy
 *    from something that only has to be reproducible.
 */
export function deriveSeed(runSeed: number, ...parts: string[]): number {
  const canonical = parts.map((p) => `${p.length}:${p}`).join('');
  return ((runSeed ^ hashToInt(canonical)) >>> 0) >>> 1;
}

/** The largest value a Postgres `Int` column holds. Anything persisted as a seed must fit. */
export const MAX_SIGNED_INT32 = 2_147_483_647;
