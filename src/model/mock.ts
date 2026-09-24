/**
 * The mock provider.
 *
 * This is NOT a stand-in that pretends to be a model. It produces structurally valid, deterministic
 * answers so that the orchestration, the schema validation, the anti-herding arithmetic and the
 * whole interface can be exercised without a network call — and everything it produces is labelled
 * as mock, all the way to the report.
 *
 * Its answers vary with the seed and with the persona, because an orchestrator tested only against
 * identical answers would never exercise its disagreement handling. They are not, and are never
 * presented as, an opinion about the world.
 */
import {
  approximateTokens,
  seededRandom,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
} from '@/model/provider';

const STANCES = ['confirm', 'dispute', 'abstain'] as const;

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Shape the answer to whatever the stage asked for.
 *
 * Each branch matches a schema the orchestrator validates, so a change to a schema that this does
 * not follow shows up as a validation failure in the tests rather than as a silent mismatch later.
 */
function body(schemaName: string, rng: () => number, personaKey: string): unknown {
  switch (schemaName) {
    case 'independent_assessment':
      return {
        stance: pick(rng, STANCES),
        confidence: round(0.4 + rng() * 0.55),
        rationale:
          `[MOCK] Placeholder assessment generated locally for ${personaKey}. It exercises the ` +
          'pipeline and says nothing about the world.',
        evidenceCited: [],
        uncertainties: ['[MOCK] Placeholder uncertainty.'],
      };

    case 'consumer_reaction':
      return {
        reaction: pick(rng, ['positive', 'mixed', 'negative']),
        intensity: round(rng()),
        verbatim: `[MOCK] Placeholder reaction text for ${personaKey}.`,
        drivers: ['[MOCK] placeholder driver'],
        barriers: ['[MOCK] placeholder barrier'],
      };

    case 'cross_examination':
      return {
        challenge: `[MOCK] Placeholder challenge to the prevailing view, from ${personaKey}.`,
        targetsClaim: true,
        alternativeExplanation: '[MOCK] Placeholder alternative explanation.',
        severity: pick(rng, ['minor', 'material', 'fundamental']),
      };

    case 'revision':
      return {
        // Whether a persona moves is the input to the anti-herding check, so it must vary.
        changed: rng() > 0.6,
        stance: pick(rng, STANCES),
        confidence: round(0.3 + rng() * 0.6),
        reason: `[MOCK] Placeholder revision reasoning for ${personaKey}.`,
      };

    case 'synthesis':
      return {
        headline: '[MOCK] Placeholder synthesis. Produced by the mock provider, not by a model.',
        findings: [
          {
            claim: '[MOCK] Placeholder finding.',
            support: 'weak',
            dissent: '[MOCK] Placeholder recorded dissent.',
          },
        ],
        limitations: [
          'This run used the mock provider. No model was consulted and nothing here is evidence.',
        ],
      };

    default:
      return { note: `[MOCK] No shape is defined for schema "${schemaName}".` };
  }
}

export class MockProvider implements ModelProvider {
  readonly name = 'mock' as const;
  readonly modelId = 'mock-deterministic-v1';

  async complete(request: ModelRequest): Promise<ModelResponse> {
    // Optional pacing (MOCK_PROVIDER_DELAY_MS, default 0) so the live interface can be watched and
    // tested with the mock provider. It changes how long a call takes, not what it returns, and the
    // recorded latency is the real elapsed time. Never above 5s.
    const delay = Math.min(5000, Math.max(0, Number(process.env.MOCK_PROVIDER_DELAY_MS ?? 0) || 0));
    const started = Date.now();
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const rng = seededRandom(request.seed ?? 1);
    const text = JSON.stringify(body(request.schemaName, rng, request.personaKey ?? 'unknown'));

    const inputTokens =
      approximateTokens(request.system) +
      request.messages.reduce((s, m) => s + approximateTokens(m.content), 0);

    return {
      provider: 'mock',
      modelId: this.modelId,
      text,
      inputTokens,
      outputTokens: approximateTokens(text),
      // Zero, and stated as zero: a mock run must never appear in a budget as if it cost something.
      costUsd: 0,
      latencyMs: Date.now() - started,
      outcome: 'ok',
    };
  }
}

/** Shown wherever a mock-produced result is displayed. */
export const MOCK_NOTICE =
  'Produced by the local mock provider. No AI model was consulted. These values exist to exercise ' +
  'the pipeline and are not evidence of anything.';
