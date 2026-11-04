'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A 1280 × 720 slide scaled to the width it is given, so the report reads at any screen size and
 * prints at exactly one slide per page (print CSS removes the scale).
 */
export function ScaledSlide({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
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
  return (
    <div ref={ref} className="slide-frame" style={{ height: 720 * scale }}>
      <div className="slide shadow-card" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
