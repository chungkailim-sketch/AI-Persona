/**
 * The single entry point for every model call in the application.
 *
 * Nothing calls a provider directly. Going through here guarantees four things that would otherwise
 * be four separate conventions to remember:
 *
 *  1. Every call is recorded as a `ModelCall` — stage, persona, provider, tokens, cost, latency,
 *     outcome, and whether the answer satisfied its schema. That record is the run's accounting and
 *     its audit trail, and it is written whether the call succeeded or failed.
 *  2. The budget is checked before the call and updated after it. A run that would exceed its cap
 *     stops rather than continuing and presenting a bill afterwards.
 *  3. The answer is parsed and validated against the schema the caller asked for. An answer that
 *     does not fit is retried once with a repair instruction, and then given up on — a third
 *     attempt at a model that has twice produced the wrong shape is rarely the difference.
 *  4. Chain-of-thought is never requested and never stored.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { MockProvider } from '@/model/mock';
import { AnthropicProvider } from '@/model/anthropic';
import type { ModelProvider, ModelRequest, ModelResponse } from '@/model/provider';

let provider: ModelProvider | null = null;

export function modelProvider(): ModelProvider {
  if (provider) return provider;
  provider = env().MODEL_PROVIDER === 'anthropic' ? new AnthropicProvider() : new MockProvider();
  return provider;
}

/** Test seam. */
export function setModelProvider(p: ModelProvider | null): void {
  provider = p;
}

export class BudgetExceeded extends Error {
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(
      `This run has spent $${spentUsd.toFixed(2)} of its $${capUsd.toFixed(2)} cap and stopped. ` +
        'Nothing further was requested.',
    );
    this.name = 'BudgetExceeded';
  }
}

export interface CallOptions<T> {
  runId: string;
  stage: string;
  personaKey?: string;
  system: string;
  messages: ModelRequest['messages'];
  schemaName: string;
  schema: z.ZodType<T>;
  seed?: number;
  /** Hash of the evidence that was placed in this prompt, so a finding can be traced to it. */
  evidenceManifestHash?: string;
  budgetCapUsd?: number;
  promptTemplate: string;
  promptVersion: string;
  /** Called before each attempt, so a caller can record that a call (or a repair) is in flight. */
  onAttempt?: (attempt: number) => Promise<void> | void;
}

export interface CallResult<T> {
  ok: boolean;
  value?: T;
  outcome: ModelResponse['outcome'] | 'schema_invalid';
  isMock: boolean;
  costUsd: number;
  /** How many attempts were made. 2 means the first answer failed its schema and was repaired. */
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/** The running total for a run, read from the calls already recorded. */
export async function runSpendUsd(runId: string): Promise<number> {
  const agg = await prisma.modelCall.aggregate({
    where: { runId },
    _sum: { costUsd: true },
  });
  return agg._sum.costUsd ?? 0;
}

/**
 * Extract the JSON object from a model answer.
 *
 * Models wrap JSON in prose or fences often enough that refusing anything but a bare object would
 * throw away good answers. This finds the outermost braces and parses that — it does not attempt to
 * repair malformed JSON, because a "repaired" answer is a guess about what the model meant.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object was found.');

  return JSON.parse(candidate.slice(start, end + 1));
}

const REPAIR_INSTRUCTION =
  'Your previous answer did not match the required JSON shape. Reply with the JSON object only — ' +
  'no prose, no code fence, no explanation.';

export async function callModel<T>(options: CallOptions<T>): Promise<CallResult<T>> {
  const p = modelProvider();
  const isMock = p.name === 'mock';

  if (options.budgetCapUsd !== undefined && !isMock) {
    const spent = await runSpendUsd(options.runId);
    if (spent >= options.budgetCapUsd) throw new BudgetExceeded(spent, options.budgetCapUsd);
  }

  let messages = options.messages;
  let lastOutcome: CallResult<T>['outcome'] = 'error';
  let totalCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let latencyMs = 0;
  let attempts = 0;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await options.onAttempt?.(attempt);
    const response = await p.complete({
      stage: options.stage,
      personaKey: options.personaKey,
      system: options.system,
      messages,
      schemaName: options.schemaName,
      seed: options.seed,
    });
    totalCost += response.costUsd;
    inputTokens += response.inputTokens;
    outputTokens += response.outputTokens;
    latencyMs += response.latencyMs;
    attempts = attempt;

    let parsed: T | undefined;
    let schemaValid = false;
    if (response.outcome === 'ok') {
      try {
        parsed = options.schema.parse(extractJson(response.text));
        schemaValid = true;
      } catch {
        schemaValid = false;
      }
    }

    await prisma.modelCall.create({
      data: {
        runId: options.runId,
        stage: options.stage,
        personaKey: options.personaKey ?? null,
        provider: response.provider,
        modelId: response.modelId,
        promptTemplate: options.promptTemplate,
        promptVersion: options.promptVersion,
        seed: options.seed ?? null,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        costUsd: response.costUsd,
        latencyMs: response.latencyMs,
        attempt,
        outcome: response.outcome === 'ok' && !schemaValid ? 'invalid' : response.outcome,
        errorCategory: response.outcome === 'ok' ? null : response.outcome,
        schemaValid,
        evidenceManifestHash: options.evidenceManifestHash ?? null,
      },
    });

    if (response.outcome === 'ok' && schemaValid) {
      return {
        ok: true,
        value: parsed,
        outcome: 'ok',
        isMock,
        costUsd: totalCost,
        attempts,
        inputTokens,
        outputTokens,
        latencyMs,
      };
    }

    lastOutcome = response.outcome === 'ok' ? 'schema_invalid' : response.outcome;

    // Only a shape problem is worth a second attempt. A refusal, a timeout or a rate limit is the
    // queue's business, not something to paper over by asking again immediately.
    if (lastOutcome !== 'schema_invalid') break;
    messages = [...options.messages, { role: 'user', content: REPAIR_INSTRUCTION }];
  }

  return {
    ok: false,
    outcome: lastOutcome,
    isMock,
    costUsd: totalCost,
    attempts,
    inputTokens,
    outputTokens,
    latencyMs,
  };
}
