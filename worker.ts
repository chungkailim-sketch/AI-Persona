/**
 * Background worker.
 *
 * Runs as a separate process from the web server — on Railway, a second service against the same
 * database. Ingestion and simulation take minutes, and a request handler that waited for them would
 * be killed by a platform timeout long before the work finished.
 *
 * Shutdown is deliberate: on SIGTERM the loop stops taking new work and waits for the job in hand.
 * A worker killed mid-job is recovered by the heartbeat, but finishing cleanly avoids the wait.
 */
// Loads `.env` for local development. In production the platform injects the environment and no
// `.env` file exists, so this is a no-op there. Next loads `.env` for the web process itself; the
// worker is a separate process and gets nothing for free.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { env } from './src/lib/env';
import {
  QUEUE_CONFIG,
  claimNext,
  complete,
  fail,
  heartbeat,
  reclaimStalled,
  type ClaimedJob,
  type ErrorCategory,
} from './src/queue/queue';
import { runIngest } from './src/ingest/pipeline';
import { datasetEmitter, emitTelemetry } from './src/telemetry/emit';
import { prisma } from './src/lib/prisma';
import { executeRun } from './src/run/orchestrator';
import { provisionDemoWorkspace } from './src/demo/provision';
import { runForecastAnalysis } from './src/forecast/analysis';

const WORKER_ID = `${process.env.RAILWAY_REPLICA_ID ?? 'local'}-${randomUUID().slice(0, 8)}`;

let running = true;
let inFlight = 0;

function log(message: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), worker: WORKER_ID, message, ...extra }));
}

/** Map a thrown error to a retry decision. Anything unrecognised is internal and is not retried. */
function categorise(e: unknown): { category: ErrorCategory; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket hang up|Connection terminated/i.test(message)) {
    return { category: 'transient', message };
  }
  if (/rate.?limit|429|overloaded|503/i.test(message)) return { category: 'provider', message };
  if (
    /does not exist|no files were attached|could not be parsed|was never confirmed|no hypothesis|no approved personas|has not been permitted/i.test(
      message,
    )
  ) {
    // A refusal is a decision, not a fault. Retrying it would produce the same refusal and waste
    // the queue's time telling the user nothing new.
    return { category: 'input', message };
  }
  if (/spent \$.* cap/i.test(message)) return { category: 'input', message };
  return { category: 'internal', message };
}

async function handle(job: ClaimedJob): Promise<Record<string, unknown>> {
  switch (job.kind) {
    case 'ingest': {
      const input = job.input as { datasetVersionId?: string };
      if (!input.datasetVersionId) throw new Error('Job input does not name a dataset version.');
      const outcome = await runIngest(input.datasetVersionId, { correlationId: job.id });
      return outcome as unknown as Record<string, unknown>;
    }
    case 'simulate': {
      const input = job.input as { runId?: string };
      if (!input.runId) throw new Error('Job input does not name a run.');
      const outcome = await executeRun(input.runId);
      return outcome as unknown as Record<string, unknown>;
    }
    case 'trend_analysis': {
      const input = job.input as { analysisId?: string };
      if (!input.analysisId) throw new Error('Job input does not name an analysis.');
      const outcome = await runForecastAnalysis(input.analysisId, job.id);
      return outcome as unknown as Record<string, unknown>;
    }
    case 'demo_provision': {
      // Development only by construction: `provisionDemoWorkspace` returns immediately in
      // production and whenever no demonstration credential is configured.
      const outcome = await provisionDemoWorkspace();
      return outcome as unknown as Record<string, unknown>;
    }
    default:
      // Not "silently ignored": an unknown kind is a deployment mismatch and should be loud.
      throw new Error(`No handler is registered for job kind "${job.kind}".`);
  }
}

const CATEGORY_TEXT: Record<string, string> = {
  transient: 'a temporary infrastructure error',
  provider: 'the model provider refusing or rate-limiting the request',
  input: 'a problem with the input that a retry would not change',
  internal: 'an internal error',
};

/**
 * Put a job failure into the live stream. The raw error message is never included — it can name
 * uploaded fields — only its category, the retry decision and the job id to find it by.
 */
async function recordJobFailure(job: ClaimedJob, e: unknown, category: string, retrying: boolean): Promise<void> {
  const input = (job.input ?? {}) as { datasetVersionId?: string; runId?: string };
  const message = retrying
    ? `Job failed because of ${CATEGORY_TEXT[category] ?? 'an error'}. A retry is scheduled (attempt ${job.attempt} of ${job.maxAttempts}).`
    : `Job failed because of ${CATEGORY_TEXT[category] ?? 'an error'}. No retry is scheduled.`;
  try {
    if (job.kind === 'ingest' && input.datasetVersionId) {
      const emit = await datasetEmitter(input.datasetVersionId, job.id);
      const stage = (e as { ingestStage?: string } | null)?.ingestStage;
      if (stage && retrying) {
        await emit({ eventType: 'ingest.stage.retryable', stage, status: 'failed', retryable: true, severity: 'error', message });
      }
      await emit({ eventType: retrying ? 'job.retry.scheduled' : 'job.failed', stage: 'job', status: retrying ? 'retryable' : 'failed', retryable: retrying, severity: 'error', message, safeMetadata: { jobKind: job.kind, attempt: job.attempt } });
    } else if (job.kind === 'simulate' && input.runId) {
      const run = await prisma.run.findUnique({ where: { id: input.runId }, select: { projectId: true, isMock: true } });
      if (run) {
        await emitTelemetry({
          eventType: retrying ? 'job.retry.scheduled' : 'job.failed',
          sourceType: 'run',
          sourceId: input.runId,
          projectId: run.projectId,
          runId: input.runId,
          stage: 'job',
          status: retrying ? 'retryable' : 'failed',
          retryable: retrying,
          severity: 'error',
          correlationId: job.id,
          isMock: run.isMock,
          message,
          safeMetadata: { jobKind: job.kind, attempt: job.attempt },
        });
      }
    }
  } catch {
    // Telemetry never costs the worker its loop.
  }
}

async function processOne(job: ClaimedJob): Promise<void> {
  inFlight += 1;
  const beat = setInterval(() => {
    void heartbeat(job.id, WORKER_ID).catch(() => undefined);
  }, QUEUE_CONFIG.heartbeatEveryMs);

  const startedAt = Date.now();
  try {
    const output = await handle(job);
    await complete(job.id, output);
    log('job completed', { jobId: job.id, kind: job.kind, ms: Date.now() - startedAt });
  } catch (e) {
    const { category, message } = categorise(e);
    const { retrying } = await fail(job.id, category, message);
    await recordJobFailure(job, e, category, retrying);
    log('job failed', {
      jobId: job.id,
      kind: job.kind,
      category,
      retrying,
      attempt: job.attempt,
      // The message is logged; it never reaches the browser, because it can name uploaded fields.
      error: message.slice(0, 300),
    });
  } finally {
    clearInterval(beat);
    inFlight -= 1;
  }
}

async function loop(): Promise<void> {
  const concurrency = env().WORKER_CONCURRENCY;
  log('worker started', { concurrency });

  const reclaimTimer = setInterval(() => {
    void reclaimStalled()
      .then((n) => { if (n > 0) log('reclaimed stalled jobs', { count: n }); })
      .catch(() => undefined);
  }, QUEUE_CONFIG.stallAfterMs / 2);

  while (running) {
    if (inFlight >= concurrency) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    let job: ClaimedJob | null = null;
    try {
      job = await claimNext(WORKER_ID, ['ingest', 'simulate', 'export', 'demo_provision', 'trend_analysis']);
    } catch (e) {
      log('could not reach the queue', { error: e instanceof Error ? e.message : String(e) });
      await new Promise((r) => setTimeout(r, 5_000));
      continue;
    }
    if (!job) {
      await new Promise((r) => setTimeout(r, 1_000));
      continue;
    }
    void processOne(job);
  }

  clearInterval(reclaimTimer);
  while (inFlight > 0) await new Promise((r) => setTimeout(r, 200));
  log('worker stopped cleanly');
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (!running) return;
    log('shutdown requested; finishing work in hand', { inFlight });
    running = false;
  });
}

loop().catch((e: unknown) => {
  log('worker crashed', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
