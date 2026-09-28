/**
 * Network-boundary handling (Next 16 renamed `middleware` to `proxy`).
 *
 * Two jobs, both of which must happen on every request:
 *
 * 1. **Content Security Policy with a per-request nonce.** A policy of `script-src 'self'` alone
 *    is not merely strict — it is broken, because Next injects an inline bootstrap script that
 *    such a policy blocks, leaving a page that renders and then never becomes interactive. A fresh
 *    nonce per request is what allows that one script while still refusing anything an attacker
 *    injects. `'strict-dynamic'` then lets Next's bootstrap load the chunks it needs without
 *    listing each one. `'unsafe-eval'` is admitted in development only, where React uses `eval` to
 *    reconstruct server stack traces; production responses never carry it.
 *
 * 2. **A coarse authentication gate.** It answers one question — is there a session cookie at all
 *    — so that an unauthenticated visitor is redirected rather than shown a shell that then fails
 *    piecemeal. It deliberately does NOT read the database or decide permissions: session
 *    validity, user status and every permission are checked again in the server component or route
 *    handler that touches the data, where the answer cannot be bypassed by forging a cookie shaped
 *    like a token.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_CONFIG } from '@/auth/config';

const PUBLIC_PATHS = ['/', '/sign-in', '/api/health', '/api/auth'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Tailwind ships as a stylesheet, so 'self' covers it; the nonce covers Next's critical CSS.
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    // Inline style *attributes* (bar widths, Radix positioning). A nonce disables 'unsafe-inline' for
    // elements, which is right; attributes cannot carry script, so they are allowed separately.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const { pathname, search } = request.nextUrl;

  const response = ((): NextResponse => {
    if (isPublic(pathname)) return NextResponse.next({ request: { headers: requestHeaders } });

    if (request.cookies.get(SESSION_CONFIG.cookieName)?.value) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    }

    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  })();

  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Static assets carry no script and need no policy; prefetches are excluded because a
    // prefetched document would otherwise be cached with a nonce that the real request will not
    // match.
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
