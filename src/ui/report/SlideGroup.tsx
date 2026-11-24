'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/**
 * A run of slides of one kind (the persona profiles) that can be folded away in the report preview.
 *
 * Collapsed (the default): one compact card with a chip per slide — a click on a chip opens the
 * group at that slide, "View all" opens it at the top. Expanded: a bar stays pinned under the page
 * header while the group is on screen, so the group can be collapsed from any slide in it; collapsing
 * brings the card back into view, and reading carries on with the next part of the report. The
 * choice is remembered for the page, like the page's other sections.
 */
export function SlideGroup({ id, title, count, chips, children }: { id: string; title: string; count: number; chips: { id: string; label: ReactNode }[]; children: ReactNode }) {
  const path = usePathname();
  const key = `rf.slidegroup:${path}:${id}`;
  const [open, setOpen] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(key) === '1') setOpen(true);
    } catch { /* nothing remembered */ }
  }, [key]);

  const set = (v: boolean, target?: string) => {
    setOpen(v);
    try { sessionStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ }
    requestAnimationFrame(() => {
      const el = target ? document.getElementById(target) : top.current;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <section ref={top} id={id} aria-label={title} className="scroll-mt-24">
      {!open ? (
        <div className="no-print rounded-lg border border-line bg-surface px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">{title}</p>
              <p className="text-xs text-ink-muted">{`${count} slides, folded to keep the report short. Open one, or view them all.`}</p>
            </div>
            <button type="button" onClick={() => set(true)} className="rounded-full bg-action px-4 py-1.5 text-[13px] font-medium text-action-ink hover:opacity-90">
              {`View all ${count}`}
            </button>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {chips.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => set(true, c.id)} className="inline-flex items-center gap-2 rounded-full border border-line px-2.5 py-1 text-xs text-ink hover:border-brand">
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="no-print sticky top-[68px] z-10 flex items-center justify-between gap-3 rounded-lg border border-line bg-elevated/95 px-4 py-2 shadow-card backdrop-blur">
            <p className="text-sm font-semibold text-ink">{`${title} · ${count}`}</p>
            <button type="button" onClick={() => set(false)} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1 text-[13px] font-medium text-ink hover:border-brand">
              <span aria-hidden>▲</span> {`Collapse ${title.toLowerCase()}`}
            </button>
          </div>
          {children}
          <div className="no-print flex justify-end">
            <button type="button" onClick={() => set(false)} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1 text-[13px] font-medium text-ink hover:border-brand">
              <span aria-hidden>▲</span> {`Collapse ${title.toLowerCase()}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
