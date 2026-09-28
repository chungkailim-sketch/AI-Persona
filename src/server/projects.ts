/**
 * Project operations.
 *
 * Every function here takes the acting user and performs its own authorization. Nothing in this
 * module trusts that a caller already checked — that is what makes "enforced server-side" true
 * rather than aspirational.
 */
import { prisma } from '@/lib/prisma';
import { can, type ProjectRole } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { recordAudit } from '@/lib/audit';

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  currentStep: string;
  isDemo: boolean;
  role: ProjectRole;
  updatedAt: Date;
  memberCount: number;
}

/**
 * Projects visible to this user.
 *
 * Membership is the filter, for every role including SUPER_ADMIN. A platform administrator does
 * not see client projects merely by being an administrator; reaching one requires an audited
 * break-glass grant (PRD §10.1).
 */
export async function listProjectsForUser(user: SessionUser): Promise<ProjectSummary[]> {
  const memberships = await prisma.projectMember.findMany({
    where: { userId: user.userId, project: { archivedAt: null } },
    include: { project: { include: { _count: { select: { members: true } } } } },
    orderBy: { project: { updatedAt: 'desc' } },
  });

  return memberships.map((m) => ({
    id: m.project.id,
    name: m.project.name,
    description: m.project.description,
    status: m.project.status,
    currentStep: m.project.currentStep,
    isDemo: m.project.isDemo,
    role: m.role as ProjectRole,
    updatedAt: m.project.updatedAt,
    memberCount: m.project._count.members,
  }));
}

/** The default workspace. Multi-workspace tenancy is modelled but not exposed in this build. */
async function defaultWorkspaceId(): Promise<string> {
  const existing = await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing.id;
  const created = await prisma.workspace.create({ data: { name: 'Default workspace' } });
  return created.id;
}

export async function createProject(
  user: SessionUser,
  input: { name: string; description?: string },
  meta: { ip?: string | null } = {},
): Promise<{ id: string }> {
  // Creating a project needs no pre-existing membership — it is the act that creates one — but it
  // does require an active standard account, which the session resolution already guarantees.
  const workspaceId = await defaultWorkspaceId();

  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        workspaceId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        createdById: user.userId,
        status: 'DRAFT',
      },
    });
    await tx.projectMember.create({
      data: { projectId: p.id, userId: user.userId, role: 'OWNER', addedBy: user.userId },
    });
    return p;
  });

  await recordAudit({
    action: 'project.created',
    targetType: 'project',
    targetId: project.id,
    projectId: project.id,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: { name: project.name },
    ip: meta.ip ?? null,
  });

  return { id: project.id };
}

export async function getProjectForUser(user: SessionUser, projectId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);
  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      members: { include: { user: { select: { email: true, displayName: true } } } },
    },
  });
}
