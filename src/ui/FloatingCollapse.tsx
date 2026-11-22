'use client';

import { useEffect, useState } from 'react';

/**
 * While a long collapsible section is open and its title has scrolled out of view, a button fixed to
 * the bottom right of the window closes it and brings its title back into view — no scrolling up.
 */
export function FloatingCollapse({ targetId, label }: { targetId: string; label: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const details = document.getElementById(targetId) as HTMLDetailsElement | null;
    const summary = details?.querySelector('summary');
    if (!details || !summary) return;
    let titleVisible = true;
    const update = () => setShow(details.open && !titleVisible);
    const io = new IntersectionObserver(([e]) => {
      titleVisible = Boolean(e?.isIntersecting);
      update();
    });
    io.observe(summary);
    details.addEventListener('toggle', update);
    return () => {
      io.disconnect();
      details.removeEventListener('toggle', update);
    };
  }, [targetId]);
  if (!show) return null;
  return (
    <button
      type="button"
      className="no-print fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-brand-deep px-4 py-2.5 text-[13px] font-semibold text-brand-deep-ink shadow-card hover:opacity-90"
      onClick={() => {
        const details = document.getElementById(targetId) as HTMLDetailsElement | null;
        if (!details) return;
        details.open = false;
        details.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
    >
      <span aria-hidden>▲</span>
      {label}
    </button>
  );
}
