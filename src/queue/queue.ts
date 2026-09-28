/**
 * Durable job queue on PostgreSQL.
 *
 * `SELECT ... FOR UPDATE SKIP LOCKED` is what makes this safe with several workers: each claim
 * takes a row lock, and any worker that would have waited for that lock skips the row instead. No
 * job is handed to two workers, and no worker blocks behind another's work.
 *
 * Postgres rather than Redis because the jobs must survive a restart and must be inspectable in the
 * admin console, and because a second piece of infrastructure at pilot scale buys nothing. The
 * `QUEUE_DRIVER` setting exists for when that stops being true.
 *
 * A job that dies mid-flight is recovered by its heartbeat: a claimed job that has not beaten for
 * longer than the stall timeout is returned to the queue, because a worker that stopped beating has
 * stopped working, whatever it believes.
 */
import { prisma } from '@/lib/prisma';

export const QUEUE_CONFIG = {
  stallAfterMs: 90_000,
  heartbeatEveryMs: 15_000,
  backoffBaseMs: 5_000,
  backoffMaxMs: 5 * 60_000,
} as const;

export type JobKind = 'ingest' | 'simulate' | 'export' | 'demo_provision' | 'trend_analysis' | 'debate';

export interface ClaimedJob {
  id: string;
  kind: string;
  attempt: number;
  maxAttempts: number;
  input: unknown;
}

export interface EnqueueInput {
  kind: JobKind;
  input: Record<string, unknown>;
  runId?: string | null;
  priority?: number;
  maxAttempts?: number;
  /**
   * Makes enqueueing idempotent. A double-submitted form, or a retry of the HTTP request that
   * created the job, must not produce two runs of the same work.
   */
  idempotencyKey?: string;
}

export async function enqueue(input: EnqueueInput): Promise<{ id: string; created: boolean }> {
  if (input.idempotencyKey) {
    const existing = await prisma.job.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
  }

  try {
    const job = await prisma.job.create({
      data: {
        kind: input.kind,
        input: input.input as object,
        runId: input.runId ?? null,
        priority: input.priority ?? 100,
        maxAttempts: input.maxAttempts ?? 3,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      select: { id: true },
    });
    return { id: job.id, created: true };
  } catch (e) {
    // Two requests can pass the check above simultaneously; the unique index is what actually
    // enforces idempotency, so a violation here means the other request won and that is fine.
    if (input.idempotencyKey) {
      const existing = await prisma.job.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (existing) return { id: existing.id, created: false };
    }
    throw e;
  }
}

/**
 * Claim one job atomically.
 *
 * Written as raw SQL because `SKIP LOCKED` has no expression in the query builder, and because the
 * claim must be a single statement — a read followed by a write, however quick, is a race.
 */
export async function claimNext(workerId: string, kinds: JobKind[]): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRawUnsafe<
    { id: string; kind: string; attempt: number; maxAttempts: number; input: unknown }[]
  >(
    `
    UPDATE "Job" SET
      status = 'RUNNING',
      "claimedAt" = now(),
      "claimedBy" = $1,
      "heartbeatAt" = now(),
      attempt = attempt + 1
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'PENDING'
        AND "availableAt" <= now()
        AND kind = ANY($2::text[])
      ORDER BY priority ASC, "availableAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, kind, attempt, "maxAttempts", input
    `,
    workerId,
    kinds,
  );
  return rows[0] ?? null;
}

export async function heartbeat(jobId: string, workerId: string): Promise<void> {
  await prisma.job.updateMany({
    where: { id: jobId, claimedBy: workerId, status: 'RUNNING' },
    data: { heartbeatAt: new Date() },
  });
}

export async function complete(jobId: string, output: Record<string, unknown>): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', completedAt: new Date(), output: output as object },
  });
}

export type ErrorCategory =
  | 'input'
  | 'permission'
  | 'transient'
  | 'provider'
  | 'internal';

/**
 * Record a failure and decide whether to retry.
 *
 * The category decides, not the attempt count alone: a malformed file will be just as malformed on
 * the third attempt, and retrying it wastes time and tells the user nothing. Only `transient` and
 * `provider` failures are worth repeating.
 */
export async function fail(
  jobId: string,
  category: ErrorCategory,
  message: string,
): Promise<{ retrying: boolean }> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { attempt: true, maxAttempts: true },
  });
  if (!job) return { retrying: false };

  const retriable = category === 'transient' || category === 'provider';
  const canRetry = retriable && job.attempt < job.maxAttempts;

  if (canRetry) {
    const delay = Math.min(
      QUEUE_CONFIG.backoffBaseMs * 2 ** (job.attempt - 1),
      QUEUE_CONFIG.backoffMaxMs,
    );
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        claimedBy: null,
        claimedAt: null,
        availableAt: new Date(Date.now() + delay),
        errorCategory: category,
        errorMessage: message.slice(0, 1000),
      },
    });
    return { retrying: true };
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      errorCategory: category,
      errorMessage: message.slice(0, 1000),
    },
  });
  return { retrying: false };
}

/** Return jobs whose worker stopped beating. Called on a timer by every worker. */
export async function reclaimStalled(): Promise<number> {
  const cutoff = new Date(Date.now() - QUEUE_CONFIG.stallAfterMs);
  const result = await prisma.job.updateMany({
    where: { status: 'RUNNING', heartbeatAt: { lt: cutoff } },
    data: {
      status: 'PENDING',
      claimedBy: null,
      claimedAt: null,
      availableAt: new Date(),
      errorCategory: 'transient',
      errorMessage: 'The worker holding this job stopped responding; it was returned to the queue.',
    },
  });
  return result.count;
}

export async function cancel(jobId: string): Promise<void> {
  await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });
}

export async function queueDepth(): Promise<{ pending: number; running: number; failed: number }> {
  const [pending, running, failed] = await Promise.all([
    prisma.job.count({ where: { status: 'PENDING' } }),
    prisma.job.count({ where: { status: 'RUNNING' } }),
    prisma.job.count({ where: { status: 'FAILED' } }),
  ]);
  return { pending, running, failed };
}
