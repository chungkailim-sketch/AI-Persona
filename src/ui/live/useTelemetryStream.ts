'use client';
/**
 * Subscribe to a telemetry stream.
 *
 * Incoming events are batched (flushed at most every 250ms, and not at all while the tab is hidden)
 * so a burst of a thousand events costs a handful of renders. The browser keeps at most
 * `bufferLimit` events; older ones remain on the server and in the export. Every merge is
 * idempotent and order-safe, and the server's snapshot — sent on every (re)connection — is taken
 * as the truth for run and dataset status.
 */
import { useEffect, useRef, useState } from 'react';
import { mergeEvents, isSettled, type StreamSnapshot, type TelemetryEvent } from '@/telemetry/contract';
import { PollingTransport, SseTransport, streamUrl, type ConnectionState, type EventTransport } from './transport';

export interface StreamOptions {
  projectId: string;
  scope: { runId?: string | null; datasetVersionId?: string | null; cohortId?: string | null };
  initialEvents: TelemetryEvent[];
  initialSnapshot: StreamSnapshot | null;
  /** Inject a transport (fixtures in tests and demonstrations). Defaults to SSE with polling fallback. */
  transport?: EventTransport;
  bufferLimit?: number;
  /** Start even if the snapshot says the subject has settled. */
  force?: boolean;
  flushMs?: number;
}

export interface StreamState {
  events: TelemetryEvent[];
  snapshot: StreamSnapshot | null;
  connection: ConnectionState;
  lastEventAt: string | null;
  /** Events received since mount — used for the "delayed" judgement. */
  received: number;
}

export function useTelemetryStream(opts: StreamOptions): StreamState {
  const { projectId, initialEvents, initialSnapshot, transport, bufferLimit = 1000, force, flushMs = 250 } = opts;
  const runId = opts.scope.runId ?? null;
  const datasetVersionId = opts.scope.datasetVersionId ?? null;
  const cohortId = opts.scope.cohortId ?? null;

  const [events, setEvents] = useState<TelemetryEvent[]>(initialEvents);
  const [snapshot, setSnapshot] = useState<StreamSnapshot | null>(initialSnapshot);
  const [connection, setConnection] = useState<ConnectionState>(
    initialSnapshot && isSettled(initialSnapshot) && !force ? 'closed' : 'connecting',
  );
  const [received, setReceived] = useState(0);

  const cursor = useRef<number>(Math.max(initialSnapshot?.cursor ?? 0, ...initialEvents.map((e) => e.seq), 0));
  const queue = useRef<TelemetryEvent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settledAtStart = Boolean(initialSnapshot && isSettled(initialSnapshot) && !force);

  useEffect(() => {
    if (settledAtStart) return;
    const scope = { runId, datasetVersionId, cohortId };
    const flush = () => {
      timer.current = null;
      if (typeof document !== 'undefined' && document.hidden) return; // resumes on visibilitychange
      const batch = queue.current;
      if (batch.length === 0) return;
      queue.current = [];
      setEvents((prev) => mergeEvents(prev, batch, bufferLimit));
      setReceived((n) => n + batch.length);
    };
    const schedule = () => {
      if (timer.current) return;
      timer.current = setTimeout(flush, flushMs);
    };
    const onVisible = () => {
      if (!document.hidden) flush();
    };
    document.addEventListener('visibilitychange', onVisible);

    const t =
      transport ??
      new SseTransport(
        (after) => streamUrl(projectId, scope, 'events', after),
        new PollingTransport((after) => streamUrl(projectId, scope, 'poll', after)),
      );
    const stop = t.start(
      {
        onEvents(batch) {
          for (const e of batch) if (e.seq > cursor.current) cursor.current = e.seq;
          queue.current.push(...batch);
          schedule();
        },
        onSnapshot(s) {
          setSnapshot(s);
        },
        onStatus(s) {
          setConnection(s);
        },
      },
      () => cursor.current,
    );
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [projectId, runId, datasetVersionId, cohortId, transport, bufferLimit, flushMs, settledAtStart]);

  const lastEventAt = events.length ? events[events.length - 1]!.timestamp : null;
  return { events, snapshot, connection, lastEventAt, received };
}
