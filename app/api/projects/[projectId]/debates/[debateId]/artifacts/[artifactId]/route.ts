/**
 * GET /api/projects/:projectId/debates/:debateId/artifacts/:artifactId — a communications strategy
 * report as a Markdown file. Taking a report out of the application needs `report.export`.
 */
import { requireUserApi } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/audit';
import { reportMarkdown } from '@/debate/insights';
import type { CommsReport } from '@/debate/insightSchemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ projectId: string; debateId: string; artifactId: string }> },
): Promise<Response> {
  let user;
  try {
    user = await requireUserApi();
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const { projectId, debateId, artifactId } = await ctx.params;
  const auth = await authContextFor(user, projectId);
  if (!can(auth, 'project.view', projectId)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const a = await prisma.debateArtifact.findFirst({
    where: { id: artifactId, debateId, projectId, kind: 'COMMS_REPORT', status: 'COMPLETED' },
    include: { debate: { select: { topic: true, isMock: true } } },
  });
  if (!a?.content) return Response.json({ error: 'Not found.' }, { status: 404 });
  if (!can(auth, 'report.export', projectId)) {
    return Response.json({ error: 'Downloading a report needs the report.export permission.' }, { status: 403 });
  }
  await recordAudit({
    action: 'report.exported',
    targetType: 'debateArtifact',
    targetId: artifactId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
  });
  const md = reportMarkdown(a.content as unknown as CommsReport, { topic: a.debate.topic, createdAt: a.createdAt, isMock: a.debate.isMock });
  return new Response(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="comms-strategy-${artifactId.slice(-8)}.md"`,
    },
  });
}
