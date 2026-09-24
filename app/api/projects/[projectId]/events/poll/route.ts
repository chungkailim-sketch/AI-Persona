/**
 * GET /api/projects/:projectId/events/poll — the fallback when an event stream cannot be held
 * open. Same scope rules, same event contract, same snapshot; the browser asks every few seconds.
 */
import { requireUserApi } from '@/auth/guard';
import { authorizeStream, readEventsAfter, readSnapshot, StreamRefused } from '@/telemetry/read';
import { cursorFrom, scopeFromUrl } from '@/telemetry/scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, ctx: { params: Promise<{ projectId: string }> }): Promise<Response> {
  let user;
  try {
    user = await requireUserApi();
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const { projectId } = await ctx.params;
  const url = new URL(request.url);
  const scope = scopeFromUrl(projectId, url);
  if (!scope) return Response.json({ error: 'Not found.' }, { status: 404 });
  try {
    await authorizeStream(user, scope);
  } catch (e) {
    if (e instanceof StreamRefused) return Response.json({ error: 'Not found.' }, { status: 404 });
    throw e;
  }
  const after = cursorFrom(url.searchParams.get('after'));
  const [events, snapshot] = await Promise.all([readEventsAfter(scope, after, 500), readSnapshot(scope)]);
  return Response.json(
    { events, snapshot, cursor: events.length ? events[events.length - 1]!.seq : after },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
