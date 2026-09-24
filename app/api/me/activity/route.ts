/**
 * GET /api/me/activity — the global run indicator's data: runs in progress across the projects the
 * caller can see. Counts only; no project names cross this boundary for projects not listed.
 */
import { requireUserApi } from '@/auth/guard';
import { activeRunsFor } from '@/server/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  let user;
  try {
    user = await requireUserApi();
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  const activity = await activeRunsFor(user);
  return Response.json(activity, { headers: { 'Cache-Control': 'no-store' } });
}
