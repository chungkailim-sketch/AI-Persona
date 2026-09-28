'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * A polite live region that announces at most one message every `minIntervalMs`. Only meaningful
 * changes are passed in (stage changes, failures, completion) — individual events never are.
 * A newer message replaces a queued one rather than stacking behind it.
 */
export function LiveAnnouncer({ message, minIntervalMs = 4000, assertive = false }: { message: string | null; minIntervalMs?: number; assertive?: boolean }) {
  const [spoken, setSpoken] = useState('');
  const last = useRef(0);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!message) return;
    pending.current = message;
    const say = () => {
      timer.current = null;
      if (pending.current) {
        setSpoken(pending.current);
        pending.current = null;
        last.current = Date.now();
      }
    };
    const wait = Math.max(0, last.current + minIntervalMs - Date.now());
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(say, wait);
  }, [message, minIntervalMs]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div className="sr-only" role={assertive ? 'alert' : 'status'} aria-live={assertive ? 'assertive' : 'polite'} aria-atomic="true">
      {spoken}
    </div>
  );
}
