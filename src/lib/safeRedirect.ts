/**
 * Open-redirect guard.
 *
 * `next=` arrives from the URL, so it is attacker-controlled. Only a path on this origin is
 * accepted: it must start with a single `/`, must not start with `//` or `/\` (both of which many
 * browsers treat as protocol-relative and therefore off-site), and must not contain a scheme.
 */
export function safeInternalPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback;
  const v = value.trim();
  if (!v.startsWith('/')) return fallback;
  if (v.startsWith('//') || v.startsWith('/\\')) return fallback;
  if (/^\/[^/]*:/.test(v)) return fallback;
  if (v.includes('\n') || v.includes('\r')) return fallback;
  return v;
}
