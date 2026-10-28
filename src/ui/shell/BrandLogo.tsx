/**
 * The rf.AI Persona logo. The wordmark is black, so the dark theme gets a variant with a white
 * wordmark; which one shows is decided by the stylesheet (`.logo-on-light` / `.logo-on-dark`), the
 * same way the theme itself is, so there is no flash and no script.
 */
export function BrandLogo({ height = 22, className = '' }: { height?: number; className?: string }) {
  // Intrinsic size of the asset, so the browser reserves the right space before it loads.
  const width = Math.round((height * 1809) / 319);
  return (
    <span className={`inline-flex items-center ${className}`}>
      <img src="/brand/ai-persona.webp" alt="rf.AI Persona" width={width} height={height} className="logo-on-light" />
      <img src="/brand/ai-persona-dark.webp" alt="rf.AI Persona" width={width} height={height} className="logo-on-dark" />
    </span>
  );
}
