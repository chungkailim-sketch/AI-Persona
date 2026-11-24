'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Collapsible sections remember being open. When someone opens a section, follows a link inside it
 * (a persona, a plan, an edit page) and comes back — with the back button or a link — the sections
 * they had open are open again and the page returns to where they were, so they carry on through
 * the section instead of opening it again.
 *
 * State is kept per page for the browser session (sessionStorage); a section is keyed by its id, or
 * by its position on the page when it has none.
 */
const KEY = 'rf.sections:';
const SCROLL = 'rf.scroll:';

const read = <T,>(k: string, fallback: T): T => {
  try {
    const v = sessionStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    sessionStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode or full: nothing to remember */
  }
};

function sections(): { el: HTMLDetailsElement; key: string }[] {
  const all = [...document.querySelectorAll<HTMLDetailsElement>('main details, #main details')];
  const seen = new Set<HTMLDetailsElement>();
  return all
    .filter((el) => (seen.has(el) ? false : (seen.add(el), true)))
    .map((el, i) => ({ el, key: el.id ? `#${el.id}` : `@${i}` }));
}

export function RememberSections() {
  const path = usePathname();

  useEffect(() => {
    const page = path;
    const stored = read<Record<string, boolean>>(KEY + page, {});
    // Open what was open; leave everything else as the page rendered it (collapsed by default).
    let opened = false;
    for (const { el, key } of sections()) {
      if (stored[key] && !el.open) {
        el.open = true;
        opened = true;
      }
    }
    // Back to where the reader was, once the sections they had open have their height again.
    const y = read<number | null>(SCROLL + page, null);
    if (opened && y !== null) requestAnimationFrame(() => window.scrollTo({ top: y }));

    const onToggle = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLDetailsElement)) return;
      const state: Record<string, boolean> = {};
      for (const { el, key } of sections()) if (el.open) state[key] = true;
      write(KEY + page, state);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => write(SCROLL + page, Math.round(window.scrollY)), 150);
    };
    // Where the reader was when they followed a link: recorded at the click, before the next page
    // scrolls to its top (a write on the way out would record that new position instead).
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('a[href], button')) write(SCROLL + page, Math.round(window.scrollY));
    };
    // `toggle` does not bubble; listen in the capture phase.
    document.addEventListener('toggle', onToggle, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('toggle', onToggle, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [path]);

  return null;
}
