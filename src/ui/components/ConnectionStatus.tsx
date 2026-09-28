import type { ConnectionState } from '../live/transport';
import { LiveIndicator, type LiveState } from './LiveIndicator';
import { fmtTime, TZ_LABEL } from '@/lib/time';

const MAP: Record<ConnectionState, { state: LiveState; label: string; detail: string }> = {
  connecting: { state: 'idle', label: 'Connecting', detail: 'Opening the live stream.' },
  live: { state: 'live', label: 'Live', detail: 'Streaming from the server as events are recorded.' },
  reconnecting: { state: 'delayed', label: 'Reconnecting', detail: 'The stream dropped; resuming from the last event received.' },
  polling: { state: 'delayed', label: 'Polling', detail: 'Streaming is unavailable; checking the server every few seconds.' },
  offline: { state: 'offline', label: 'Offline', detail: 'The server cannot be reached. What is shown may be out of date.' },
  closed: { state: 'complete', label: 'Up to date', detail: 'Nothing more is changing. Showing the recorded history.' },
  fixture: { state: 'idle', label: 'Fixture', detail: 'Demonstration fixture data, not a live system.' },
  denied: { state: 'failed', label: 'No access', detail: 'You do not have access to this stream.' },
};

/** Whether what is on screen is live, delayed, stale, finished or a fixture — always stated in words. */
export function ConnectionStatus({ state, lastEventAt }: { state: ConnectionState; lastEventAt?: string | null }) {
  const m = MAP[state];
  return (
    <span className="inline-flex items-center gap-2" title={m.detail} data-connection={state}>
      <LiveIndicator state={m.state} label={m.label} />
      <span className="sr-only">{m.detail}</span>
      {lastEventAt && (
        <span className="hidden font-mono text-[10.5px] text-ink-subtle sm:inline">last event {fmtTime(lastEventAt)} {TZ_LABEL}</span>
      )}
    </span>
  );
}
