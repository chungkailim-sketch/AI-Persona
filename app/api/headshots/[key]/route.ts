import { NextResponse } from 'next/server';
import { loadHeadshot } from '@/headshots/store';

export const dynamic = 'force-dynamic';

/**
 * One headshot. The catalog is fixed and carries nothing about any study, so it is cacheable: in the
 * browser for a day, and in this process for five minutes — a personas page asks for fifteen of them,
 * and fifteen database reads per page view was needless work on a busy click-through.
 */
const MEMORY = new Map<string, { at: number; mime: string; data: Buffer; etag: string }>();
const TTL_MS = 5 * 60_000;

export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!/^hs-\d{2}$/.test(key)) return new NextResponse('Not found', { status: 404 });
  let hit = MEMORY.get(key);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    const h = await loadHeadshot(key);
    if (!h) return new NextResponse('Not found', { status: 404 });
    hit = { at: Date.now(), mime: h.mime, data: h.data, etag: `"${key}-${h.data.length}-${h.data.subarray(0, 16).toString('hex')}"` };
    MEMORY.set(key, hit);
  }
  const headers = { 'Content-Type': hit.mime, 'Cache-Control': 'public, max-age=86400', ETag: hit.etag, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" };
  if (req.headers.get('if-none-match') === hit.etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(new Uint8Array(hit.data), { headers });
}
