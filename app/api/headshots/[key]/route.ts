import { NextResponse } from 'next/server';
import { loadHeadshot } from '@/headshots/store';

export const dynamic = 'force-dynamic';

/** One illustrated headshot. The catalog is fixed and carries nothing about any study, so it is cacheable. */
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!/^hs-\d{2}$/.test(key)) return new NextResponse('Not found', { status: 404 });
  const h = await loadHeadshot(key);
  if (!h) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(h.data), { headers: { 'Content-Type': h.mime, 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } });
}
