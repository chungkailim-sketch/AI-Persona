'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A 1280 × 720 slide scaled to the width it is given, so the report reads at any screen size and
 * prints at exactly one slide per page (print CSS removes the scale).
 *
 * Text never spills out of its space: every FitBox on the slide is checked once the fonts have
 * loaded (and again whenever its text changes, e.g. when the deck is translated) and, if its content
 * runs past its box, the content is scaled down in small steps until it fits.
 */
export function ScaledSlide({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / 1280) || 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const slide = slideRef.current;
    if (!slide) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fitting = false;
    const run = () => {
      fitting = true;
      fitSlide(slide);
      // Let the observer see (and ignore) our own style writes before listening again.
      setTimeout(() => (fitting = false), 0);
    };
    const later = () => {
      if (fitting) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 120);
    };
    void (document.fonts?.ready ?? Promise.resolve()).then(run);
    const mo = new MutationObserver(later);
    mo.observe(slide, { subtree: true, childList: true, characterData: true });
    window.addEventListener('beforeprint', run);
    return () => {
      mo.disconnect();
      window.removeEventListener('beforeprint', run);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return (
    <div ref={ref} className="slide-frame" style={{ height: 720 * scale }}>
      <div ref={slideRef} className="slide shadow-card" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

/** A box whose content is scaled down, if need be, so that it stays inside it. */
export function FitBox({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div data-fit className={`overflow-hidden ${className}`}>
      <div data-fit-inner className="h-full w-full">{children}</div>
    </div>
  );
}

const MIN_ZOOM = 0.5;

// Under CSS zoom a percentage size still resolves against the (unzoomed) box, so the inner keeps
// filling its box while everything sized in pixels inside it shrinks.
function setZoom(inner: HTMLElement, z: number) {
  inner.style.zoom = z >= 0.999 ? '' : String(z);
}

function overflows(box: HTMLElement, inner: HTMLElement): boolean {
  if (inner.scrollHeight > inner.clientHeight + 1 || inner.scrollWidth > inner.clientWidth + 1) return true;
  const b = box.getBoundingClientRect();
  const tol = Math.max(1, b.height * 0.004);
  for (const el of inner.querySelectorAll<HTMLElement>('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Shapes inside a drawing (the map) are clipped by the drawing itself.
    if (el.parentElement?.closest('svg')) continue;
    if (r.bottom > b.bottom + tol || r.right > b.right + tol || r.left < b.left - tol) return true;
  }
  return false;
}

const depth = (el: Element) => {
  let d = 0;
  for (let p = el.parentElement; p; p = p.parentElement) d++;
  return d;
};

export function fitSlide(slide: HTMLElement): void {
  const boxes = [...slide.querySelectorAll<HTMLElement>('[data-fit]')];
  for (const box of boxes) setZoom(box.firstElementChild as HTMLElement, 1);
  // Innermost first, so a long label shrinks its own cell before the whole slide body is touched.
  boxes.sort((a, b) => depth(b) - depth(a));
  for (const box of boxes) {
    const inner = box.firstElementChild as HTMLElement | null;
    if (!inner) continue;
    let z = 1;
    while (z > MIN_ZOOM && overflows(box, inner)) {
      z = Math.round((z - 0.04) * 100) / 100;
      setZoom(inner, z);
    }
  }
}
