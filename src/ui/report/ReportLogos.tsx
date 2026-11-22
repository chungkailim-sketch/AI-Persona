'use client';

import { useBrandLogo } from './BrandContext';

/**
 * Ruder Finn and rf.AI Persona side by side, for the report deck (slides and the printed PDF).
 *
 * Both are the supplied artwork exactly as given — no dark-theme variant. Slides are always white
 * paper (`.slide-deck` in globals.css), so the original colours are the right ones in either theme.
 */
export function ReportLogos({ height = 20, className = '' }: { height?: number; className?: string }) {
  // A client brand template with a logo replaces both marks.
  const brand = useBrandLogo();
  if (brand.logo) {
    return (
      <span className={`inline-flex items-center ${className}`}>
        <img src={brand.logo} alt={brand.name ?? 'Logo'} style={{ height: Math.round(height * 1.5), width: 'auto', maxWidth: height * 12 }} />
      </span>
    );
  }
  // The Ruder Finn wordmark is a little taller than the rf.AI Persona one at the same visual weight.
  const rf = Math.round(height * 1.15);
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <img src="/brand/ruderfinn-original.jpg" alt="Ruder Finn" width={Math.round((rf * 805) / 216)} height={rf} />
      <span aria-hidden className="w-px self-center bg-line-strong" style={{ height: rf }} />
      <img src="/brand/ai-persona-original.png" alt="rf.AI Persona" width={Math.round((height * 1790) / 299)} height={height} />
    </span>
  );
}
