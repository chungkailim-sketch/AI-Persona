import { afterEach, describe, expect, it, vi } from 'vitest';
import { decide, parseDecisionResponse, type DecisionQuestion } from '../../src/decision/client';
import { resetEnvCache } from '../../src/lib/env';

process.env.DATABASE_URL ??= 'postgresql://x@localhost/x';
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters-long';

const Q: DecisionQuestion[] = [
  { name: 'ready', type: 'predicate', instructions: 'x' },
  { name: 'next', type: 'choice', instructions: 'x', choices: [{ value: 'a' }, { value: 'b' }] },
  { name: 'fit', type: 'score', instructions: 'x', levels: [{ label: 'Poor' }, { label: 'Fair' }, { label: 'Good' }] },
];

describe('Decisions API replies', () => {
  it('reads answers by name, with probabilities as an object or a list', () => {
    const a = parseDecisionResponse(
      {
        answers: [
          { name: 'next', choice: 'b', probabilities: [{ value: 'a', probability: 0.3 }, { value: 'b', probability: 0.7 }], confidence: 0.8 },
          { name: 'ready', probability: 0.82 },
          { name: 'fit', score: 1.43, probabilities: { Poor: 0.1, Fair: 0.37, Good: 0.53 } },
        ],
      },
      Q,
    );
    expect(a[0]).toMatchObject({ name: 'ready', probability: 0.82 });
    expect(a[1]).toMatchObject({ choice: 'b', probabilities: { a: 0.3, b: 0.7 }, confidence: 0.8 });
    expect(a[2]).toMatchObject({ score: 1.43, probabilities: { Good: 0.53 } });
  });

  it('reads the reply exactly as the official guide shows it, including a refusal', () => {
    const a = parseDecisionResponse(
      {
        answers: [
          { type: 'refusal', name: 'ready' },
          { type: 'choice', name: 'next', choice: 'a', probabilities: [{ value: 'a', probability: 0.95 }, { value: 'b', probability: 0.05 }], confidence: 0.93 },
          { type: 'score', name: 'fit', score: 1.1, probabilities: [{ value: 0, label: 'Poor', probability: 0.1 }, { value: 1, label: 'Fair', probability: 0.7 }, { value: 2, label: 'Good', probability: 0.2 }], confidence: 0.55 },
        ],
      },
      Q,
    );
    expect(a[0]).toMatchObject({ name: 'ready', refused: true });
    expect(a[1]).toMatchObject({ choice: 'a', probabilities: { a: 0.95, b: 0.05 }, confidence: 0.93 });
    expect(a[2]).toMatchObject({ score: 1.1, probabilities: { Poor: 0.1, Fair: 0.7, Good: 0.2 } });
  });

  it('falls back to position and to the most probable choice', () => {
    const a = parseDecisionResponse({ answers: [{ answer: true }, { probabilities: { a: 0.9, b: 0.1 } }, { expected_score: 2 }] }, Q);
    expect(a[0]!.probability).toBe(1);
    expect(a[1]!.choice).toBe('a');
    expect(a[2]!.score).toBe(2);
  });
});

describe('decide()', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENAI_API_KEY; resetEnvCache(); });

  it('answers with a labelled local stand-in when no key is set, deterministically', async () => {
    delete process.env.OPENAI_API_KEY;
    resetEnvCache();
    const one = await decide('same input', Q);
    const two = await decide('same input', Q);
    expect(one.isMock).toBe(true);
    expect(one.answers).toEqual(two.answers);
    expect(Object.keys(one.answers[1]!.probabilities!)).toEqual(['a', 'b']);
  });

  it('posts model, input and questions to /v1/decisions with the key', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    resetEnvCache();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: [{ probability: 0.6 }, { choice: 'a' }, { score: 0 }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await decide('input', Q);
    expect(r.isMock).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/decisions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'gpt-6-luna', input: 'input', questions: Q });
  });

  it('says what went wrong when the API refuses', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    resetEnvCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'Bad key' } }), { status: 401 })));
    await expect(decide('input', Q)).rejects.toThrow(/401 \(invalid_api_key\): Bad key/);
  });
});
