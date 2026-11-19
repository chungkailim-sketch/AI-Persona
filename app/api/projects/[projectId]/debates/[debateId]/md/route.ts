/** GET /api/projects/:projectId/debates/:debateId/md — a swarm debate as Markdown. Needs report.view. */
import { requireUserApi } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { debateMarkdown } from '@/debate/markdown';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ projectId: string; debateId: string }> }): Promise<Response> {
  const { projectId, debateId: id } = await ctx.params;
  let user;
  try {
    user = await requireUserApi();
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!can(await authContextFor(user, projectId), 'report.view', projectId)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const debate = await prisma.debate.findFirst({ where: { id, projectId }, include: { turns: { orderBy: { seq: 'asc' } }, project: { select: { name: true } } } });
  if (!debate) return Response.json({ error: 'Not found.' }, { status: 404 });
  const project = debate.project.name;
  const md = debateMarkdown(debate, project);
  const KIND = 'debate';
  const file = `${project.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-') || 'project'}-${KIND}-${id.slice(-6)}.md`;
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file)}"; filename*=UTF-8''${encodeURIComponent(file)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
