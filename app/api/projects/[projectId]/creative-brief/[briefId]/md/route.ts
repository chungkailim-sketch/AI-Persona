/** GET /api/projects/:projectId/creative-brief/:briefId/md — the AIGC creative brief as Markdown. Needs report.view. */
import { requireUserApi } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { creativeBriefMarkdown } from '@/creative/markdown';
import type { CreativeBriefContent } from '@/creative/fields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ projectId: string; briefId: string }> }): Promise<Response> {
  const { projectId, briefId } = await ctx.params;
  let user;
  try {
    user = await requireUserApi();
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!can(await authContextFor(user, projectId), 'report.view', projectId)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const advice = await prisma.advice.findFirst({ where: { id: briefId, projectId, kind: 'CREATIVE_BRIEF', status: 'COMPLETED' }, include: { project: { select: { name: true } } } });
  if (!advice?.content) return Response.json({ error: 'Not found.' }, { status: 404 });
  const content = advice.content as unknown as CreativeBriefContent;
  const md = creativeBriefMarkdown(content, { projectName: advice.project.name, generatedOn: (advice.completedAt ?? advice.createdAt).toISOString().slice(0, 10) });
  const name = `${advice.project.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-') || 'project'}-creative-brief-${content.fields.version || 'v1'}.md`;
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
