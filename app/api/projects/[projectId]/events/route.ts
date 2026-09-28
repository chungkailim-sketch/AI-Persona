/**
 * GET /api/projects/:projectId/events — Server-Sent Events for ingestion, cohorts and runs.
 *
 * Why SSE: the traffic is one-way (server → browser), it rides ordinary HTTP through Railway's
 * proxy, the browser reconnects on its own and resends `Last-Event-ID`, and the web process needs
 * no in-memory pub/sub — events are read from the `TelemetryEvent` table, which the worker writes
 * from a different process. That table is the source of truth; the stream is a view of it.
 *
 * The stream is bounded: it ends after a few minutes (the browser resumes from its cursor) or as
 * soon as the subject settles, so an idle tab does not hold a connection and a database poller
 * forever. Authorization is re-evaluated on every reconnection.
 */
import { requireUserApi } from '@/auth/guard';
import { authorizeStream, isSettled, readEventsAfter, readSnapshot, StreamRefused } from '@/telemetry/read';
import { cursorFrom, scopeFromUrl } from '@/telemetry/scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;
const SNAPSHOT_MS = 5_000;
const MAX_LIFETIME_MS = 4 * 60_000;

export async function GET(request: Request, ctx: { params: Promise<{ projectId: string }> }): Promise<Response> {
  let user;
  try {
    user = await requireUserApi();
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { projectId } = await ctx.params;
  const url = new URL(request.url);
  const scope = scopeFromUrl(projectId, url);
  if (!scope) return Response.json({ error: 'Not found.' }, { status: 404 });

  try {
    await authorizeStream(user, scope);
  } catch (e) {
    if (e instanceof StreamRefused) return Response.json({ error: 'Not found.' }, { status: 404 });
    throw e;
  }

  let cursor = cursorFrom(request.headers.get('last-event-id') ?? url.searchParams.get('after'));
  const encoder = new TextEncoder();
  let closed = false;
  request.signal.addEventListener('abort', () => {
    closed = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown, id?: number) =>
        write(`${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const started = Date.now();
      let lastBeat = started;
      let lastSnapshot = started;
      write('retry: 3000\n\n');

      try {
        send('snapshot', await readSnapshot(scope));
        while (!closed && Date.now() - started < MAX_LIFETIME_MS) {
          const events = await readEventsAfter(scope, cursor, 200);
          if (events.length > 0) {
            cursor = events[events.length - 1]!.seq;
            send('events', events, cursor);
            continue; // drain a backlog before sleeping
          }
          const now = Date.now();
          if (now - lastSnapshot >= SNAPSHOT_MS) {
            lastSnapshot = now;
            const snap = await readSnapshot(scope);
            send('snapshot', snap);
            if (isSettled(snap) && snap.cursor <= cursor) {
              send('end', { reason: 'settled' });
              break;
            }
          }
          if (now - lastBeat >= HEARTBEAT_MS) {
            lastBeat = now;
            write(': ping\n\n');
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
        if (!closed && Date.now() - started >= MAX_LIFETIME_MS) send('end', { reason: 'rotate' });
      } catch {
        // No stack trace reaches the browser. The client falls back to polling on an error event.
        send('stream-error', { message: 'The live stream stopped. Reconnecting.' });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
