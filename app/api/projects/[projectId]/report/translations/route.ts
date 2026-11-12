/**
 * POST /api/projects/:projectId/report/translations — { lang, strings } → { entries, missing }.
 *
 * The report deck's text in another language: what is stored is returned; what is missing is queued
 * for translation once (see src/roundtable/reportLocale.ts). Needs report.view on the project.
 */
import { requireUserApi } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { deckTranslations, isDeckLang, requestDeckTranslation } from '@/roundtable/reportLocale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ projectId: string }> }): Promise<Response> {
  const { projectId } = await ctx.params;
  let user;
  try {
    user = await requireUserApi();
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!can(await authContextFor(user, projectId), 'report.view', projectId)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { lang?: unknown; strings?: unknown } | null;
  if (!body || !isDeckLang(body.lang) || !Array.isArray(body.strings)) return Response.json({ error: 'A language and the strings are required.' }, { status: 400 });
  const rt = await prisma.roundtable.findFirst({ where: { projectId, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' }, select: { id: true } });
  if (!rt) return Response.json({ error: 'Not found.' }, { status: 404 });
  const { entries, missing } = await deckTranslations(body.lang, body.strings);
  await requestDeckTranslation(projectId, rt.id, body.lang, missing);
  return Response.json({ entries, missing: missing.length }, { headers: { 'Cache-Control': 'private, no-store' } });
}
