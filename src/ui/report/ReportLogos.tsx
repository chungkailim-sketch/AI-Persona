import { BrandLogo } from '../shell/BrandLogo';

/** Ruder Finn and rf.AI Persona side by side, for the report deck (slides and the printed PDF). */
export function ReportLogos({ height = 20, className = '' }: { height?: number; className?: string }) {
  // The Ruder Finn wordmark is a little taller than the rf.AI Persona one at the same visual weight.
  const rf = Math.round(height * 1.15);
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <img src="/brand/ruderfinn.webp" alt="Ruder Finn" width={Math.round((rf * 805) / 216)} height={rf} />
      <span aria-hidden className="h-[1.1em] w-px self-center bg-line-strong" style={{ height: rf }} />
      <BrandLogo height={height} />
    </span>
  );
}
