// @vitest-environment node
/**
 * The job queue against a real PostgreSQL instance.
 *
 * `SKIP LOCKED` cannot be tested against a mock: the property under test is a database behaviour,
 * and a mock would only confirm that the code calls the method the test expects.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER = 'test-pepper';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, resetDatabase } from './helpers';
import {
  QUEUE_CONFIG,
  cancel,
  claimNext,
  complete,
  enqueue,
  fail,
  heartbeat,
  queueDepth,
  reclaimStalled,
} from '../../src/queue/queue';

describe('enqueueing', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('creates a pending job', async () => {
    const { id, created } = await enqueue({ kind: 'ingest', input: { datasetVersionId: 'x' } });
    expect(created).toBe(true);
    const job = await db.job.findUniqueOrThrow({ where: { id } });
    expect(job.status).toBe('PENDING');
    expect(job.attempt).toBe(0);
  });

  it('is idempotent, so a double-submitted form does not run the work twice', async () => {
    const a = await enqueue({ kind: 'ingest', input: { v: 1 }, idempotencyKey: 'ingest:abc' });
    const b = await enqueue({ kind: 'ingest', input: { v: 1 }, idempotencyKey: 'ingest:abc' });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.id).toBe(a.id);
    expect(await db.job.count()).toBe(1);
  });

  it('treats concurrent enqueues with the same key as one job', async () => {
    // Both calls pass the existence check before either inserts; the unique index is what decides.
    const results = await Promise.all([
      enqueue({ kind: 'ingest', input: {}, idempotencyKey: 'race' }),
      enqueue({ kind: 'ingest', input: {}, idempotencyKey: 'race' }),
      enqueue({ kind: 'ingest', input: {}, idempotencyKey: 'race' }),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await db.job.count()).toBe(1);
  });
});

describe('claiming', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('hands a job to exactly one worker', async () => {
    await enqueue({ kind: 'ingest', input: { n: 1 } });

    const claims = await Promise.all([
      claimNext('worker-a', ['ingest']),
      claimNext('worker-b', ['ingest']),
      claimNext('worker-c', ['ingest']),
    ]);
    const got = claims.filter((c) => c !== null);
    expect(got).toHaveLength(1);
  });

  it('gives three workers three different jobs rather than blocking', async () => {
    await enqueue({ kind: 'ingest', input: { n: 1 } });
    await enqueue({ kind: 'ingest', input: { n: 2 } });
    await enqueue({ kind: 'ingest', input: { n: 3 } });

    const claims = await Promise.all([
      claimNext('worker-a', ['ingest']),
      claimNext('worker-b', ['ingest']),
      claimNext('worker-c', ['ingest']),
    ]);
    const ids = claims.filter((c) => c !== null).map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('respects priority, then age', async () => {
    const low = await enqueue({ kind: 'ingest', input: { n: 'low' }, priority: 200 });
    const high = await enqueue({ kind: 'ingest', input: { n: 'high' }, priority: 10 });
    const claimed = await claimNext('w', ['ingest']);
    expect(claimed?.id).toBe(high.id);
    expect(claimed?.id).not.toBe(low.id);
  });

  it('does not claim a job of another kind', async () => {
    await enqueue({ kind: 'export', input: {} });
    expect(await claimNext('w', ['ingest'])).toBeNull();
  });

  it('does not claim a job scheduled for later', async () => {
    const { id } = await enqueue({ kind: 'ingest', input: {} });
    await db.job.update({
      where: { id },
      data: { availableAt: new Date(Date.now() + 60_000) },
    });
    expect(await claimNext('w', ['ingest'])).toBeNull();
  });

  it('increments the attempt on claim, so a crash still costs an attempt', async () => {
    await enqueue({ kind: 'ingest', input: {} });
    const claimed = await claimNext('w', ['ingest']);
    expect(claimed?.attempt).toBe(1);
  });
});

describe('failure and retry', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('retries a transient failure with growing backoff', async () => {
    await enqueue({ kind: 'ingest', input: {}, maxAttempts: 3 });
    const job = await claimNext('w', ['ingest']);
    const { retrying } = await fail(job!.id, 'transient', 'connection reset');
    expect(retrying).toBe(true);

    const after = await db.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(after.status).toBe('PENDING');
    expect(after.availableAt.getTime()).toBeGreaterThan(Date.now());
    expect(after.claimedBy).toBeNull();
  });

  it('does not retry a bad input, because it will be just as bad next time', async () => {
    await enqueue({ kind: 'ingest', input: {}, maxAttempts: 3 });
    const job = await claimNext('w', ['ingest']);
    const { retrying } = await fail(job!.id, 'input', 'the file could not be parsed');
    expect(retrying).toBe(false);

    const after = await db.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(after.status).toBe('FAILED');
    expect(after.errorCategory).toBe('input');
  });

  it('stops retrying at the attempt limit', async () => {
    await enqueue({ kind: 'ingest', input: {}, maxAttempts: 2 });
    for (let i = 0; i < 2; i += 1) {
      const job = await claimNext('w', ['ingest']);
      if (!job) {
        // The backoff pushed availability into the future; bring it forward to keep the test quick.
        await db.job.updateMany({ data: { availableAt: new Date() } });
        continue;
      }
      await fail(job.id, 'transient', 'boom');
      await db.job.updateMany({ data: { availableAt: new Date() } });
    }
    const job = await claimNext('w', ['ingest']);
    if (job) await fail(job.id, 'transient', 'boom');

    const all = await db.job.findMany();
    expect(all[0]?.status).toBe('FAILED');
  });
});

describe('stall recovery', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('returns a job whose worker stopped beating', async () => {
    await enqueue({ kind: 'ingest', input: {} });
    const job = await claimNext('worker-that-dies', ['ingest']);
    await db.job.update({
      where: { id: job!.id },
      data: { heartbeatAt: new Date(Date.now() - QUEUE_CONFIG.stallAfterMs - 1000) },
    });

    expect(await reclaimStalled()).toBe(1);

    const after = await db.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(after.status).toBe('PENDING');
    expect(after.claimedBy).toBeNull();
    expect(after.errorMessage).toMatch(/stopped responding/i);
  });

  it('leaves a job alone while its worker is still beating', async () => {
    await enqueue({ kind: 'ingest', input: {} });
    const job = await claimNext('w', ['ingest']);
    await heartbeat(job!.id, 'w');
    expect(await reclaimStalled()).toBe(0);
  });

  it('ignores a heartbeat from a worker that does not hold the job', async () => {
    await enqueue({ kind: 'ingest', input: {} });
    const job = await claimNext('worker-a', ['ingest']);
    const before = await db.job.findUniqueOrThrow({ where: { id: job!.id } });
    await heartbeat(job!.id, 'worker-b');
    const after = await db.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(after.heartbeatAt?.getTime()).toBe(before.heartbeatAt?.getTime());
  });
});

describe('completion and cancellation', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('records the output on completion', async () => {
    await enqueue({ kind: 'ingest', input: {} });
    const job = await claimNext('w', ['ingest']);
    await complete(job!.id, { rowCount: 42 });
    const after = await db.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(after.status).toBe('COMPLETED');
    expect(after.output).toMatchObject({ rowCount: 42 });
  });

  it('cancels a pending job and leaves a finished one alone', async () => {
    const pending = await enqueue({ kind: 'ingest', input: {} });
    await cancel(pending.id);
    expect((await db.job.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('CANCELLED');

    const done = await enqueue({ kind: 'ingest', input: {}, idempotencyKey: 'done' });
    const claimed = await claimNext('w', ['ingest']);
    await complete(claimed!.id, {});
    await cancel(done.id);
    expect((await db.job.findUniqueOrThrow({ where: { id: done.id } })).status).toBe('COMPLETED');
  });

  it('reports queue depth for the admin console', async () => {
    await enqueue({ kind: 'ingest', input: { n: 1 } });
    await enqueue({ kind: 'ingest', input: { n: 2 } });
    await claimNext('w', ['ingest']);
    const depth = await queueDepth();
    expect(depth.pending).toBe(1);
    expect(depth.running).toBe(1);
    expect(depth.failed).toBe(0);
  });
});
