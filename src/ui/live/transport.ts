/**
 * Transports for the telemetry stream. All three deliver the same contract to the same handlers:
 *
 *  - `SseTransport`     — Server-Sent Events; the default.
 *  - `PollingTransport` — the fallback when a stream cannot be held open (a proxy that buffers,
 *                          repeated connection errors, or no EventSource in the environment).
 *  - `FixtureTransport` — a clearly labelled demonstration / test provider replaying fixture events.
 *
 * None of them advances anything on a timer of its own: the fixture provider emits events it was
 * given, in order; the others relay what the server read from the database.
 */
import {
  parseEvents,
  StreamSnapshotSchema,
  isSettled,
  type StreamSnapshot,
  type TelemetryEvent,
} from '@/telemetry/contract';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline' | 'closed' | 'fixture' | 'denied';

export interface TransportHandlers {
  onEvents(events: TelemetryEvent[]): void;
  onSnapshot(snapshot: StreamSnapshot): void;
  onStatus(state: ConnectionState): void;
}

export interface EventTransport {
  /** Start delivering events after `cursor`. Returns a function that stops the transport. */
  start(handlers: TransportHandlers, cursor: () => number): () => void;
}

export function streamUrl(projectId: string, scope: Record<string, string | null | undefined>, kind: 'events' | 'poll', after: number): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(scope)) if (v) q.set(k, v);
  if (after > 0) q.set('after', String(after));
  return `/api/projects/${encodeURIComponent(projectId)}/events${kind === 'poll' ? '/poll' : ''}?${q.toString()}`;
}

function parseSnapshot(raw: unknown): StreamSnapshot | null {
  const p = StreamSnapshotSchema.safeParse(raw);
  return p.success ? p.data : null;
}

export class PollingTransport implements EventTransport {
  constructor(
    private readonly url: (after: number) => string,
    private readonly intervalMs = 3000,
    private readonly fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  start(h: TransportHandlers, cursor: () => number): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    h.onStatus('polling');

    const tick = async () => {
      if (stopped) return;
      try {
        const res = await this.fetcher(this.url(cursor()), { cache: 'no-store', credentials: 'same-origin' });
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          h.onStatus('denied');
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { events?: unknown; snapshot?: unknown };
        failures = 0;
        const events = parseEvents(body.events ?? []);
        if (events.length) h.onEvents(events);
        const snap = parseSnapshot(body.snapshot);
        if (snap) h.onSnapshot(snap);
        h.onStatus('polling');
        if (snap && isSettled(snap) && snap.cursor <= cursor()) {
          h.onStatus('closed');
          return;
        }
      } catch {
        failures += 1;
        h.onStatus('offline');
      }
      if (!stopped) timer = setTimeout(tick, Math.min(30_000, this.intervalMs * 2 ** Math.min(failures, 4)));
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
}

export class SseTransport implements EventTransport {
  constructor(
    private readonly url: (after: number) => string,
    private readonly fallback: EventTransport,
    private readonly maxErrorsBeforeFallback = 3,
  ) {}

  start(h: TransportHandlers, cursor: () => number): () => void {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      return this.fallback.start(h, cursor);
    }
    let stopFallback: (() => void) | null = null;
    let es: EventSource | null = null;
    let errors = 0;
    let stopped = false;

    const open = () => {
      h.onStatus(errors === 0 ? 'connecting' : 'reconnecting');
      es = new EventSource(this.url(cursor()), { withCredentials: true });
      es.addEventListener('open', () => {
        errors = 0;
        h.onStatus('live');
      });
      es.addEventListener('events', (m) => {
        const events = parseEvents(safeJson((m as MessageEvent).data));
        if (events.length) h.onEvents(events);
      });
      es.addEventListener('snapshot', (m) => {
        const snap = parseSnapshot(safeJson((m as MessageEvent).data));
        if (snap) h.onSnapshot(snap);
      });
      es.addEventListener('end', (m) => {
        const reason = (safeJson((m as MessageEvent).data) as { reason?: string } | null)?.reason;
        if (reason === 'settled') {
          es?.close();
          h.onStatus('closed');
        }
        // 'rotate': the server closes; EventSource reconnects by itself with Last-Event-ID.
      });
      es.addEventListener('error', () => {
        if (stopped) return;
        errors += 1;
        if (es && es.readyState === EventSource.CLOSED) {
          // Closed after 'settled', or refused outright (401/404 close the stream immediately).
          if (errors >= this.maxErrorsBeforeFallback) switchToPolling();
          else {
            es.close();
            setTimeout(() => !stopped && open(), 1000 * errors);
          }
          return;
        }
        if (errors >= this.maxErrorsBeforeFallback) switchToPolling();
        else h.onStatus('reconnecting');
      });
    };

    const switchToPolling = () => {
      es?.close();
      es = null;
      if (!stopFallback && !stopped) stopFallback = this.fallback.start(h, cursor);
    };

    open();
    return () => {
      stopped = true;
      es?.close();
      stopFallback?.();
    };
  }
}

function safeJson(s: unknown): unknown {
  if (typeof s !== 'string') return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Demonstration and test provider. Replays the events it is given, in order, one batch per step,
 * and says so: its connection state is `fixture`, and every event it emits is marked `isMock`.
 */
export class FixtureTransport implements EventTransport {
  constructor(
    private readonly batches: TelemetryEvent[][],
    private readonly snapshots: (StreamSnapshot | null)[] = [],
    private readonly stepMs = 0,
  ) {}

  start(h: TransportHandlers): () => void {
    let i = 0;
    let stopped = false;
    h.onStatus('fixture');
    const step = () => {
      if (stopped || i >= this.batches.length) return;
      h.onEvents(this.batches[i]!.map((e) => ({ ...e, isMock: true, safeMetadata: { ...(e.safeMetadata ?? {}), fixture: true } })));
      const snap = this.snapshots[i];
      if (snap) h.onSnapshot(snap);
      i += 1;
      if (this.stepMs > 0) setTimeout(step, this.stepMs);
      else step();
    };
    step();
    return () => {
      stopped = true;
    };
  }
}
