/**
 * GET /api/projects/:projectId/runs/:runId/telemetry — the run's complete telemetry as NDJSON.
 *
 * Export is a permission of its own (`report.export`), separate from watching: a viewer can follow
 * a run live without being able to take its record out of the application.
 */
import { requireUserApi } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/audit';
import { toContract } from '@/telemetry/read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: { params: Promise<{ projectId: string; runId: string }> }): Promise<Response> {
  let user;
  try {
    user = await requireUserApi();
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const { projectId, runId } = await ctx.params;
  const auth = await authContextFor(user, projectId);
  if (!can(auth, 'project.view', projectId)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const run = await prisma.run.findFirst({ where: { id: runId, projectId }, select: { id: true } });
  if (!run) return Response.json({ error: 'Not found.' }, { status: 404 });
  if (!can(auth, 'report.export', projectId)) {
    return Response.json({ error: 'Exporting telemetry needs the report.export permission.' }, { status: 403 });
  }

  const rows = await prisma.telemetryEvent.findMany({ where: { projectId, runId }, orderBy: { seq: 'asc' }, take: 20_000 });
  await recordAudit({
    action: 'report.exported',
    targetType: 'runTelemetry',
    targetId: runId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: { format: 'ndjson', events: rows.length },
  });
  const body = rows.map((r) => JSON.stringify(toContract(r))).join('\n') + '\n';
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="run-${runId}-telemetry.ndjson"`,
      'Cache-Control': 'no-store',
    },
  });
}
