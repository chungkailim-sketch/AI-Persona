'use client';

import { useEffect } from 'react';

/**
 * A collapsible section (`<details id="…">`) opens and comes into view when the page's in-page
 * navigation, or a link elsewhere, points at it — on arrival with a #hash, on a hash change, and on a
 * click on a link to the hash already in the address bar.
 */
export function OpenSectionFromHash() {
  useEffect(() => {
    const open = (hash: string) => {
      const id = decodeURIComponent(hash.replace(/^#/, ''));
      if (!id) return;
      const el = document.getElementById(id);
      const details = el instanceof HTMLDetailsElement ? el : el?.closest('details');
      if (!details) return;
      details.open = true;
      requestAnimationFrame(() => details.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };
    open(window.location.hash);
    const onHash = () => open(window.location.hash);
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
      if (a) open(a.getAttribute('href') ?? '');
    };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onClick);
    };
  }, []);
  return null;
}
