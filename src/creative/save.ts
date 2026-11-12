/** Saving a project's communication preferences and creative treatment (server only). */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { recordAudit } from '@/lib/audit';
import { readPrefs, type CreativePrefs } from './prefs';

export async function saveCreativePrefs(user: SessionUser, projectId: string, raw: unknown): Promise<CreativePrefs> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.edit', projectId)) throw new AuthorizationError('project.edit', projectId);
  const prefs = readPrefs(raw);
  await prisma.project.update({ where: { id: projectId }, data: { creative: prefs as object } });
  await recordAudit({ action: 'project.creative.saved', targetType: 'project', targetId: projectId, projectId, actorUserId: user.userId, actorEmail: user.email });
  return prefs;
}
