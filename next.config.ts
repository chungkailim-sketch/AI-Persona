import type { NextConfig } from 'next';
import { UPLOAD_LIMITS } from './src/ingest/limits';

// Uploads arrive through a server action. Next's defaults (1MB for server actions, 10MB through the
// proxy) are far below the 25MB-per-file limit the product promises, so a real databook failed with
// a generic 413 before any check could explain it. Both limits follow UPLOAD_LIMITS, plus headroom
// for the multipart envelope.
const uploadBodyLimit = `${Math.ceil(UPLOAD_LIMITS.maxRequestBytes / 1024 / 1024) + 1}mb` as const;

/**
 * Static security headers.
 *
 * The Content-Security-Policy is NOT set here: it carries a per-request nonce and is therefore
 * emitted by `proxy.ts`, which runs per request. A static CSP in this file would either be too
 * loose to be worth having or would block Next's own bootstrap script.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // Next 16 writes AGENTS.md/CLAUDE.md into the repo root on dev start. This project keeps its
  // own documentation under docs/, so the generated files are not wanted.
  agentRules: false,
  experimental: {
    serverActions: { bodySizeLimit: uploadBodyLimit },
    proxyClientMaxBodySize: uploadBodyLimit,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default nextConfig;
