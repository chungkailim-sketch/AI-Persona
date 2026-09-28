/**
 * GET /api/projects/:projectId/datasets/:versionId/structured/:file
 *
 * Downloads one structured table as CSV (`:file` is the table id) or the whole set's Frictionless
 * descriptor (`:file` is `datapackage.json`). Data leaving the application is an export, so it needs
 * the same permission as uploading it, is limited to versions attached to this project, drops every
 * column the field review excluded or redacted, and is audited.
 */
import { requireUserApi } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/audit';
import { exportDataPackage, exportStructuredCsv } from '@/ingest/structured';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ projectId: string; versionId: string; file: string }> },
): Promise<Response> {
  let user;
  try {
    user = await requireUserApi();
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const { projectId, versionId, file } = await ctx.params;
  const auth = await authContextFor(user, projectId);
  // Not found rather than forbidden: an outsider learns nothing about which ids exist.
  if (!can(auth, 'dataset.upload', projectId)) return Response.json({ error: 'Not found.' }, { status: 404 });
  const linked = await prisma.datasetVersion.findFirst({
    where: { id: versionId, dataset: { projects: { some: { projectId } } } },
    select: { id: true },
  });
  if (!linked) return Response.json({ error: 'Not found.' }, { status: 404 });

  if (file === 'datapackage.json') {
    const pkg = await exportDataPackage(versionId);
    if (!pkg) return Response.json({ error: 'Not found.' }, { status: 404 });
    await audit(user, projectId, versionId, 'datapackage.json', []);
    return new Response(JSON.stringify(pkg, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="datapackage.json"',
        'Cache-Control': 'no-store',
      },
    });
  }

  const out = await exportStructuredCsv(versionId, file);
  if (!out) return Response.json({ error: 'Not found.' }, { status: 404 });
  await audit(user, projectId, versionId, out.fileName, out.withheld);
  return new Response(out.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${out.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function audit(
  user: { userId: string; email: string },
  projectId: string,
  versionId: string,
  fileName: string,
  withheld: string[],
): Promise<void> {
  await recordAudit({
    action: 'dataset.structured.exported',
    targetType: 'datasetVersion',
    targetId: versionId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    reason: withheld.length > 0 ? `${fileName} downloaded; ${withheld.length} excluded column(s) withheld` : `${fileName} downloaded`,
  });
}
