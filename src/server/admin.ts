/**
 * Platform administration operations.
 *
 * Each function authorizes independently, and each mutation writes an audit event with the before
 * and after value. The escalation guards are the ones from `permissions.ts`, applied here rather
 * than re-implemented — a second implementation is a second thing to get wrong.
 */
import { prisma } from '@/lib/prisma';
import {
  SYSTEM_ROLES,
  can,
  canAssignSystemRole,
  type SystemRole,
} from '@/auth/permissions';
import { authContextFor, revokeAllSessionsForUser, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { recordAudit } from '@/lib/audit';

export function isSystemRole(v: string): v is SystemRole {
  return (SYSTEM_ROLES as readonly string[]).includes(v);
}

export async function listUsers(actor: SessionUser) {
  const ctx = await authContextFor(actor);
  if (!can(ctx, 'admin.users.manage') && !can(ctx, 'audit.view')) {
    throw new AuthorizationError('admin.users.manage');
  }
  return prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      email: true,
      displayName: true,
      systemRole: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { memberships: true, sessions: true } },
    },
    take: 200,
  });
}

export async function changeSystemRole(
  actor: SessionUser,
  targetUserId: string,
  role: SystemRole,
  meta: { ip?: string | null } = {},
): Promise<void> {
  const ctx = await authContextFor(actor);
  if (!can(ctx, 'admin.users.manage')) throw new AuthorizationError('admin.users.manage');
  // The escalation guard: an actor may only assign a role strictly below their own.
  if (!canAssignSystemRole(ctx, role)) throw new AuthorizationError('admin.roles.assign');

  const before = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, systemRole: true },
  });
  if (!before) throw new Error('No such user.');

  // Nobody may change their own role, in either direction. Self-promotion is the obvious case; the
  // subtler one is an administrator demoting themselves and stranding the platform with no admin.
  if (before.id === actor.userId) throw new AuthorizationError('admin.roles.assign');

  // Equally, an actor may not act on someone at or above their own rank.
  if (!canAssignSystemRole(ctx, before.systemRole as SystemRole)) {
    throw new AuthorizationError('admin.roles.assign');
  }

  await prisma.user.update({ where: { id: targetUserId }, data: { systemRole: role } });

  // A role change alters what existing sessions may do, so those sessions are ended rather than
  // left carrying the old authority until they expire.
  await revokeAllSessionsForUser(targetUserId, 'system role changed');

  await recordAudit({
    action: 'user.role.changed',
    targetType: 'user',
    targetId: targetUserId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    beforeValue: { systemRole: before.systemRole },
    afterValue: { systemRole: role },
    reason: `Role of ${before.email} changed by ${actor.email}`,
    ip: meta.ip ?? null,
  });
}

export async function setUserStatus(
  actor: SessionUser,
  targetUserId: string,
  status: 'ACTIVE' | 'DEACTIVATED',
  meta: { ip?: string | null } = {},
): Promise<void> {
  const ctx = await authContextFor(actor);
  if (!can(ctx, 'admin.users.manage')) throw new AuthorizationError('admin.users.manage');

  const before = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, status: true, systemRole: true },
  });
  if (!before) throw new Error('No such user.');
  if (before.id === actor.userId) throw new AuthorizationError('admin.users.manage');
  if (!canAssignSystemRole(ctx, before.systemRole as SystemRole)) {
    throw new AuthorizationError('admin.users.manage');
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: { status, deactivatedAt: status === 'DEACTIVATED' ? new Date() : null },
  });
  if (status === 'DEACTIVATED') await revokeAllSessionsForUser(targetUserId, 'user deactivated');

  await recordAudit({
    action: 'user.deactivated',
    targetType: 'user',
    targetId: targetUserId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    beforeValue: { status: before.status },
    afterValue: { status },
    ip: meta.ip ?? null,
  });
}

export async function listDomains(actor: SessionUser) {
  const ctx = await authContextFor(actor);
  if (!can(ctx, 'admin.domains.manage') && !can(ctx, 'audit.view')) {
    throw new AuthorizationError('admin.domains.manage');
  }
  return prisma.approvedDomain.findMany({ orderBy: { domain: 'asc' } });
}

export async function addDomain(
  actor: SessionUser,
  domain: string,
  meta: { ip?: string | null } = {},
): Promise<void> {
  const ctx = await authContextFor(actor);
  if (!can(ctx, 'admin.domains.manage')) throw new AuthorizationError('admin.domains.manage');

  const normalised = domain.trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(normalised)) {
    throw new Error('That is not a valid domain name.');
  }

  await prisma.approvedDomain.upsert({
    where: { domain: normalised },
    update: { active: true },
    create: { domain: normalised, createdBy: actor.userId },
  });

  await recordAudit({
    action: 'domain.added',
    targetType: 'approvedDomain',
    targetId: normalised,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    afterValue: { domain: normalised, active: true },
    ip: meta.ip ?? null,
  });
}

export async function setDomainActive(
  actor: SessionUser,
  domain: string,
  active: boolean,
  meta: { ip?: string | null } = {},
): Promise<void> {
  const ctx = await authContextFor(actor);
  if (!can(ctx, 'admin.domains.manage')) throw new AuthorizationError('admin.domains.manage');

  await prisma.approvedDomain.update({ where: { domain }, data: { active } });
  await recordAudit({
    action: active ? 'domain.added' : 'domain.removed',
    targetType: 'approvedDomain',
    targetId: domain,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    afterValue: { domain, active },
    ip: meta.ip ?? null,
  });
}

export async function listAuditEvents(actor: SessionUser, limit = 100) {
  const ctx = await authContextFor(actor);
  if (!can(ctx, 'audit.view')) throw new AuthorizationError('audit.view');
  return prisma.auditEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 500),
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      actorEmail: true,
      projectId: true,
      reason: true,
      createdAt: true,
    },
  });
}
