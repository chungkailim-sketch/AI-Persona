/**
 * Request metadata helpers.
 *
 * The client IP is only ever used to rate-limit and to hash into the audit log. Behind Railway's
 * proxy the socket address is the proxy, so `x-forwarded-for` is read — its *left-most* entry,
 * which is the value the edge proxy appended, with the rest ignored because a client can forge
 * additional entries.
 */
import { createHash } from 'node:crypto';

export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? null;
}

/** The user agent is hashed, never stored in the clear, and used only to notice token reuse. */
export function userAgentHash(headers: Headers, pepper: string): string | null {
  const ua = headers.get('user-agent');
  if (!ua) return null;
  return createHash('sha256').update(`${pepper}:${ua}`).digest('hex');
}
