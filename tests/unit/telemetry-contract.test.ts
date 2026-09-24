import { describe, expect, it } from 'vitest';
import { INGEST_STAGES, RUN_STAGE_CATALOGUE, TelemetryEventSchema, isSettled, mergeEvents, parseEvents, sanitizeMetadata } from '../../src/telemetry/contract';
import { RUN_STAGES } from '../../src/run/orchestrator';
import { ev } from './telemetry-fixtures';

describe('the event contract', () => {
  it('lists fifteen ingestion stages in order', () => {
    expect(INGEST_STAGES).toHaveLength(15);
    expect(INGEST_STAGES[0]!.key).toBe('upload_received');
    expect(INGEST_STAGES[14]!.key).toBe('import_approved');
  });

  it('mirrors the orchestrator stage list exactly', () => {
    expect(RUN_STAGE_CATALOGUE.map((s) => s.key)).toEqual([...RUN_STAGES]);
  });

  it('accepts a well-formed event and rejects one with an unknown status', () => {
    const e = ev({ stage: 'parsing', status: 'active' });
    expect(TelemetryEventSchema.safeParse(e).success).toBe(true);
    expect(TelemetryEventSchema.safeParse({ ...e, status: 'exploded' }).success).toBe(false);
  });

  it('drops anything that fails the contract when parsing a stream message', () => {
    const good = ev({ stage: 'parsing', status: 'active' });
    expect(parseEvents([good, { nope: true }, { ...good, seq: -1 }])).toHaveLength(1);
  });
});

describe('sanitising metadata', () => {
  it('keeps only allow-listed keys and scalar values', () => {
    const out = sanitizeMetadata({ personaKey: 'P1', rationale: 'secret reasoning', prompt: 'system', nested: { a: 1 }, score: 0.4 });
    expect(out).toEqual({ personaKey: 'P1', score: 0.4 });
  });

  it('refuses objects and arrays even under an allowed key, and truncates long strings', () => {
    const out = sanitizeMetadata({ action: 'x'.repeat(500), observation: ['a'] as unknown as string, count: Number.NaN });
    expect(out!.action).toHaveLength(240);
    expect(out!.observation).toBeUndefined();
    expect(out!.count).toBeNull();
  });

  it('returns null when nothing survives', () => {
    expect(sanitizeMetadata({ rationale: 'x' })).toBeNull();
  });
});

describe('merging events', () => {
  it('is idempotent: an event delivered twice is kept once', () => {
    const a = ev({ stage: 'parsing', status: 'active' });
    const once = mergeEvents([], [a]);
    expect(mergeEvents(once, [a])).toHaveLength(1);
  });

  it('sorts out-of-order delivery by server sequence', () => {
    const a = ev({ stage: 'parsing', status: 'active', seq: 10 });
    const b = ev({ stage: 'parsing', status: 'active', seq: 11 });
    const c = ev({ stage: 'parsing', status: 'active', seq: 12 });
    const merged = mergeEvents([a, c], [b]);
    expect(merged.map((e) => e.seq)).toEqual([10, 11, 12]);
  });

  it('keeps only the newest events past the buffer limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => ev({ stage: 'parsing', status: 'active', seq: 100 + i }));
    const kept = mergeEvents([], many, 5);
    expect(kept.map((e) => e.seq)).toEqual([115, 116, 117, 118, 119]);
  });

  it('returns the same array when nothing new arrived', () => {
    const a = ev({ stage: 'parsing', status: 'active' });
    const list = [a];
    expect(mergeEvents(list, [a])).toBe(list);
  });
});

describe('settledness', () => {
  const snap = (run: string | null, ds: string | null) => ({
    kind: 'snapshot' as const,
    cursor: 0,
    serverTime: '',
    run: run ? { id: 'r', status: run, isMock: true, startedAt: null, completedAt: null, cancelRequested: false, failureReason: null, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, steps: [] } : null,
    dataset: ds ? { versionId: 'v', status: ds, rowCount: null, qualityScore: null } : null,
  });
  it('treats terminal runs and reviewed datasets as settled', () => {
    expect(isSettled(snap('COMPLETED', null))).toBe(true);
    expect(isSettled(snap('REVISION', null))).toBe(false);
    expect(isSettled(snap(null, 'READY_FOR_REVIEW'))).toBe(true);
    expect(isSettled(snap(null, 'PARSING'))).toBe(false);
  });
});

describe('merging a first batch that arrives out of order', () => {
  it('sorts even when nothing was held before', () => {
    const a = ev({ stage: 'parsing', status: 'active', seq: 7 });
    const b = ev({ stage: 'parsing', status: 'active', seq: 5 });
    expect(mergeEvents([], [a, b]).map((e) => e.seq)).toEqual([5, 7]);
  });
});
