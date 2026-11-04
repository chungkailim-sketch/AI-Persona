/** Reading and saving a project's modules (server only). */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { activeModules, MODULES, USE_CASES, type ModuleKey } from './registry';

export async function projectModules(projectId: string): Promise<Set<ModuleKey>> {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { useCase: true, modules: true } });
  return activeModules(p ?? { useCase: 'market_entry', modules: [] });
}

export async function saveProjectModules(user: SessionUser, projectId: string, useCase: string, modules: string[]): Promise<void> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.edit', projectId)) throw new AuthorizationError('project.edit', projectId);
  const uc = USE_CASES.find((u) => u.key === useCase) ?? USE_CASES[0];
  const valid = modules.filter((m) => MODULES.some((x) => x.key === m));
  // Matching the preset exactly is stored as "no choice", so a later change to the preset applies.
  const same = valid.length === uc.modules.length && uc.modules.every((m) => valid.includes(m));
  // Nothing ticked is stored as a marker, since an empty list means "use the preset".
  await prisma.project.update({ where: { id: projectId }, data: { useCase: uc.key, modules: same ? [] : valid.length ? valid : ['none'] } });
}
