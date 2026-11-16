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
  type WebSource,
} from '@/model/provider';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
// Long enough for a full report (about 10k output tokens) without streaming.
const TIMEOUT_MS = 300_000;

/**
 * Models from Claude Sonnet 5.5 on reject a non-default temperature and think by default. For
 * them, temperature is left out, and thinking is switched off with `between_tools` so that every
 * output token goes to the answer, as on the older models this app was written for.
 */
function isLegacySampling(modelId: string): boolean {
  return /^claude-(sonnet|opus|haiku)-4-[0-6]/.test(modelId) || /^claude-3/.test(modelId);
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  /** web_search_tool_result: a list of results on success, a single error object otherwise. */
  content?: unknown;
}

interface AnthropicSuccess {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number; server_tool_use?: { web_search_requests?: number } };
}

// A long search turn can pause; it is sent back as it is and the server carries on.
const MAX_CONTINUATIONS = 3;
const WEB_SEARCH_USD = 0.01;

/** The answer is the text written after the last search; what came before is narration. */
function answerText(blocks: AnthropicContentBlock[]): string {
  let from = 0;
  blocks.forEach((b, i) => {
    if (b.type === 'web_search_tool_result' || b.type === 'server_tool_use') from = i + 1;
  });
  const text = (list: AnthropicContentBlock[]) => list.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('');
  return text(blocks.slice(from)) || text(blocks);
}

function searchSources(blocks: AnthropicContentBlock[]): WebSource[] {
  const out = new Map<string, WebSource>();
  for (const b of blocks) {
    if (b.type !== 'web_search_tool_result' || !Array.isArray(b.content)) continue;
    for (const r of b.content as { type?: string; url?: unknown; title?: unknown }[]) {
      if (r?.type === 'web_search_result' && typeof r.url === 'string' && /^https?:\/\//.test(r.url)) {
        out.set(r.url, { url: r.url, title: typeof r.title === 'string' ? r.title.slice(0, 300) : r.url });
      }
    }
  }
  return [...out.values()];
}

/** Attachments ride on the first user message, ahead of its text, as the API expects. */
function withAttachments(request: ModelRequest) {
  const files = request.attachments ?? [];
  if (files.length === 0) return request.messages;
  const first = request.messages.findIndex((m) => m.role === 'user');
  return request.messages.map((m, i) =>
    i !== first
      ? m
      : {
          role: m.role,
          content: [
            ...files.map((f) =>
              f.mediaType === 'application/pdf'
                ? { type: 'document', source: { type: 'base64', media_type: f.mediaType, data: f.base64 } }
                : { type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.base64 } },
            ),
            { type: 'text', text: m.content },
          ],
        },
  );
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
      const post = (messages: unknown, search: boolean) =>
        fetch(API_URL, {
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
            ...(isLegacySampling(this.modelId)
              ? { temperature: request.temperature ?? env().AI_TEMPERATURE }
              : { thinking: { type: 'between_tools' } }),
            system: request.system,
            messages,
            ...(search
              ? { tools: [{ type: isLegacySampling(this.modelId) ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: request.webSearch!.maxUses }] }
              : {}),
          }),
        });

      const first = withAttachments(request);
      let search = Boolean(request.webSearch);
      let response = await post(first, search);
      // Web search may not be switched on for the account: answer without it rather than fail.
      if (search && response.status === 400) {
        search = false;
        response = await post(first, false);
      }

      let inputTokens = 0;
      let outputTokens = 0;
      let searches = 0;
      const blocks: AnthropicContentBlock[] = [];
      let stopReason: string | null = null;
      for (let turn = 0; ; turn += 1) {
        if (response.status === 429) {
          return { ...base, latencyMs: Date.now() - startedAt, text: '', outcome: 'rate_limited', errorMessage: 'Rate limited.' };
        }
        if (!response.ok) {
          // The provider's error body can echo prompt content, so it is summarised, never passed on.
          return {
            ...base,
            latencyMs: Date.now() - startedAt,
            text: '',
            outcome: response.status >= 500 ? 'error' : 'invalid',
            errorMessage: `Provider returned HTTP ${response.status}.`,
          };
        }
        const payload = (await response.json()) as AnthropicSuccess;
        blocks.push(...payload.content);
        inputTokens += payload.usage?.input_tokens ?? 0;
        outputTokens += payload.usage?.output_tokens ?? 0;
        searches += payload.usage?.server_tool_use?.web_search_requests ?? 0;
        stopReason = payload.stop_reason;
        if (stopReason !== 'pause_turn' || turn >= MAX_CONTINUATIONS) break;
        response = await post([...first, { role: 'assistant', content: blocks }], search);
      }

      const sources = searchSources(blocks);
      return {
        ...base,
        text: answerText(blocks),
        inputTokens,
        outputTokens,
        costUsd: estimateCostUsd(this.modelId, inputTokens, outputTokens) + searches * WEB_SEARCH_USD,
        latencyMs: Date.now() - startedAt,
        outcome: stopReason === 'refusal' ? 'refused' : 'ok',
        ...(sources.length ? { sources } : {}),
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
