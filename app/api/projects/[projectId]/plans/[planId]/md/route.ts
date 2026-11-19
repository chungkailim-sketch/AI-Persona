/** GET /api/projects/:projectId/plans/:planId/md — a written comms plan as Markdown. Needs report.view. */
import { requireUserApi } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { planMarkdown } from '@/advice/planMarkdown';
import type { CommsPlan } from '@/roundtable/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ projectId: string; planId: string }> }): Promise<Response> {
  const { projectId, planId: id } = await ctx.params;
  let user;
  try {
    user = await requireUserApi();
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!can(await authContextFor(user, projectId), 'report.view', projectId)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const advice = await prisma.advice.findFirst({ where: { id, projectId, kind: 'COMMS_PLAN', status: 'COMPLETED' }, include: { project: { select: { name: true } } } });
  if (!advice?.content) return Response.json({ error: 'Not found.' }, { status: 404 });
  const project = advice.project.name;
  const md = planMarkdown(advice.content as unknown as CommsPlan, { question: advice.question, projectName: project, writtenOn: (advice.completedAt ?? advice.createdAt).toISOString().slice(0, 10), dataLines: ((advice.sources ?? {}) as { data?: string[] }).data ?? [] });
  const KIND = 'plan';
  const file = `${project.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-') || 'project'}-${KIND}-${id.slice(-6)}.md`;
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file)}"; filename*=UTF-8''${encodeURIComponent(file)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
