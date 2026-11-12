/**
 * GET /api/context?project=<id or name> — a project as Markdown, for an assistant working on it.
 *
 * Read-only, and off unless CONTEXT_API_TOKEN is set: the caller sends it as a bearer token (an
 * environment secret that a proxy adds, so it never sits in the assistant's own code). Without a
 * project, or with a name that matches several, it lists the matching projects. Every read is audited.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { clientIp } from '@/lib/request';
import { findProjects, projectContext } from '@/server/projectContext';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorised(request: Request): boolean {
  const expected = env().CONTEXT_API_TOKEN?.trim();
  if (!expected) return false;
  const given = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]?.trim() ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<NextResponse> {
  // Off (no token configured) looks the same as a wrong token: nothing says the endpoint exists.
  if (!authorised(request)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const query = new URL(request.url).searchParams.get('project') ?? '';
  const matches = await findProjects(query);
  if (matches.length !== 1) {
    return NextResponse.json(
      { error: matches.length ? 'More than one project matches; name it exactly or use its id.' : 'No project matches.', projects: matches.map((p) => ({ id: p.id, name: p.name })) },
      { status: matches.length ? 300 : 404 },
    );
  }
  const project = matches[0]!;
  const markdown = await projectContext(project.id);
  await recordAudit({ action: 'project.context.read', targetType: 'project', targetId: project.id, projectId: project.id, reason: 'Read through the context API', ip: clientIp(request.headers) });
  return NextResponse.json({ project: { id: project.id, name: project.name }, markdown });
}
