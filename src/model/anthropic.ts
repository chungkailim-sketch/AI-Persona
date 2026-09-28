/**
 * The Anthropic provider.
 *
 * Server-only. The key is read here from validated environment, is never exported, never returned,
 * never logged, and never placed on an object that reaches the browser. The admin interface can
 * report whether a key is present; it cannot read one back.
 *
 * Failures are classified rather than thrown raw, because the queue's retry decision depends on the
 * category: a rate limit is worth repeating, a refusal is not.
 */
import { env } from '@/lib/env';
import {
  estimateCostUsd,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from '@/model/provider';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const TIMEOUT_MS = 120_000;

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicSuccess {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic' as const;
  readonly modelId: string;

  constructor() {
    this.modelId = env().ANTHROPIC_MODEL_ID;
    if (!env().ANTHROPIC_API_KEY) {
      // Fail at construction, not at the first call halfway through a run.
      throw new Error('MODEL_PROVIDER=anthropic requires ANTHROPIC_API_KEY.');
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const base: Omit<ModelResponse, 'outcome' | 'text'> = {
      provider: 'anthropic',
      modelId: this.modelId,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
    };

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'anthropic-version': API_VERSION,
          // The only place this value appears.
          'x-api-key': env().ANTHROPIC_API_KEY as string,
        },
        body: JSON.stringify({
          model: this.modelId,
          max_tokens: request.maxTokens ?? env().AI_MAX_TOKENS,
          temperature: request.temperature ?? env().AI_TEMPERATURE,
          system: request.system,
          messages: request.messages,
        }),
      });

      const latencyMs = Date.now() - startedAt;

      if (response.status === 429) {
        return { ...base, latencyMs, text: '', outcome: 'rate_limited', errorMessage: 'Rate limited.' };
      }
      if (!response.ok) {
        // The provider's error body can echo prompt content, so it is summarised, never passed on.
        return {
          ...base,
          latencyMs,
          text: '',
          outcome: response.status >= 500 ? 'error' : 'invalid',
          errorMessage: `Provider returned HTTP ${response.status}.`,
        };
      }

      const payload = (await response.json()) as AnthropicSuccess;
      const text = payload.content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('');

      const inputTokens = payload.usage?.input_tokens ?? 0;
      const outputTokens = payload.usage?.output_tokens ?? 0;

      return {
        ...base,
        text,
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd(this.modelId, inputTokens, outputTokens),
        latencyMs,
        outcome: payload.stop_reason === 'refusal' ? 'refused' : 'ok',
      };
    } catch (e) {
      const latencyMs = Date.now() - startedAt;
      const aborted = e instanceof Error && e.name === 'AbortError';
      return {
        ...base,
        latencyMs,
        text: '',
        outcome: aborted ? 'timeout' : 'error',
        errorMessage: aborted ? 'The request timed out.' : 'The provider could not be reached.',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
