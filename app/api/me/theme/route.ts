/**
 * POST /api/me/theme — store the signed-in user's theme preference.
 *
 * The cookie is set here too, so the next server render already carries the right theme. The
 * browser has usually written the same cookie itself a moment earlier; this makes it authoritative.
 */
import { cookies } from 'next/headers';
import { z } from 'zod';
import { requireUserApi } from '@/auth/guard';
import { prisma } from '@/lib/prisma';
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, THEME_PREFERENCES } from '@/ui/theme/theme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ preference: z.enum(THEME_PREFERENCES) });

export async function POST(request: Request): Promise<Response> {
  let user;
  try {
    user = await requireUserApi();
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Choose light, dark or system.' }, { status: 400 });

  await prisma.user.update({ where: { id: user.userId }, data: { themePreference: parsed.data.preference } });
  const jar = await cookies();
  jar.set(THEME_COOKIE, parsed.data.preference, {
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
  });
  return Response.json({ preference: parsed.data.preference });
}
