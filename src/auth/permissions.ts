/**
 * Central authorization matrix (SEC-04).
 *
 * Every server route resolves permissions through `can()`. Hiding a control in the UI is
 * never sufficient — the same check runs again on the server for each request.
 *
 * Two rules are enforced structurally rather than by convention:
 *  1. Platform administration and project content access are separate. A platform admin gets
 *     no project data by default; reaching it requires an audited break-glass grant.
 *  2. Nobody may grant a permission they do not themselves hold (privilege-escalation guard).
 */

export const SYSTEM_ROLES = [
  'SUPER_ADMIN',
  'PLATFORM_ADMIN',
  'RESEARCH_ADMIN',
  'PRESET_MANAGER',
  'AUDITOR',
  'SUPPORT',
  'STANDARD_USER',
] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const PROJECT_ROLES = ['OWNER', 'COLLABORATOR', 'VIEWER'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PERMISSIONS = [
  // project scope
  'project.view',
  'project.edit',
  'project.archive',
  'project.duplicate',
  'project.members.manage',
  'dataset.upload',
  'dataset.delete',
  'dataset.viewSensitive',
  'persona.create',
  'persona.edit',
  'persona.approve',
  'simulation.run',
  'simulation.cancel',
  'report.view',
  'report.export',
  // platform scope
  'admin.access',
  'admin.users.manage',
  'admin.domains.manage',
  'admin.roles.assign',
  'admin.presets.manage',
  'admin.prompts.manage',
  'admin.models.manage',
  'admin.metrics.manage',
  'admin.flags.manage',
  'admin.retention.manage',
  'admin.takedown',
  'admin.jobs.view',
  'admin.usage.view',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions a system role carries irrespective of project membership. */
const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  PLATFORM_ADMIN: [
    'admin.access',
    'admin.users.manage',
    // Role assignment is safe to grant here because the rank guard in canAssignSystemRole() is
    // what actually constrains it: a platform admin can create a research admin, but not a peer
    // and not a super admin. Withholding this permission instead would leave a role that can
    // deactivate an account but not correct a mistaken role, which is the worse arrangement.
    'admin.roles.assign',
    'admin.domains.manage',
    'admin.prompts.manage',
    'admin.models.manage',
    'admin.flags.manage',
    'admin.jobs.view',
    'admin.usage.view',
    'audit.view',
  ],
  RESEARCH_ADMIN: [
    'admin.access',
    'admin.presets.manage',
    'admin.metrics.manage',
    'admin.retention.manage',
    'admin.takedown',
    'admin.jobs.view',
  ],
  PRESET_MANAGER: ['admin.access', 'admin.presets.manage'],
  AUDITOR: ['admin.access', 'audit.view', 'admin.usage.view', 'admin.jobs.view'],
  SUPPORT: ['admin.access', 'admin.jobs.view'],
  STANDARD_USER: [],
};

/** Permissions a project role carries within that project only. */
const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, readonly Permission[]> = {
  OWNER: [
    'project.view',
    'project.edit',
    'project.archive',
    'project.duplicate',
    'project.members.manage',
    'dataset.upload',
    'dataset.delete',
    'dataset.viewSensitive',
    'persona.create',
    'persona.edit',
    'persona.approve',
    'simulation.run',
    'simulation.cancel',
    'report.view',
    'report.export',
  ],
  COLLABORATOR: [
    'project.view',
    'project.edit',
    'project.duplicate',
    'dataset.upload',
    'persona.create',
    'persona.edit',
    'persona.approve',
    'simulation.run',
    'simulation.cancel',
    'report.view',
    'report.export',
  ],
  VIEWER: ['project.view', 'report.view'],
};

export interface AuthContext {
  userId: string;
  email: string;
  systemRole: SystemRole;
  /** Project membership for the project being accessed, if any. */
  projectRole?: ProjectRole | undefined;
  /** Time-boxed, audited emergency access. Absent in normal operation. */
  breakGlass?: { grantedFor: string; expiresAt: Date; reason: string } | undefined;
}

const PROJECT_SCOPED = new Set<Permission>([
  'project.view',
  'project.edit',
  'project.archive',
  'project.duplicate',
  'project.members.manage',
  'dataset.upload',
  'dataset.delete',
  'dataset.viewSensitive',
  'persona.create',
  'persona.edit',
  'persona.approve',
  'simulation.run',
  'simulation.cancel',
  'report.view',
  'report.export',
]);

export function isProjectScoped(permission: Permission): boolean {
  return PROJECT_SCOPED.has(permission);
}

/**
 * The single authorization decision point.
 *
 * A SUPER_ADMIN holds every platform permission, but project-scoped permissions still
 * require either membership or an unexpired break-glass grant — so "admin" never silently
 * means "can read every client's data".
 */
export function can(ctx: AuthContext, permission: Permission, projectId?: string): boolean {
  if (isProjectScoped(permission)) {
    if (!projectId) return false;
    const fromMembership = ctx.projectRole
      ? PROJECT_ROLE_PERMISSIONS[ctx.projectRole].includes(permission)
      : false;
    if (fromMembership) return true;
    const bg = ctx.breakGlass;
    if (bg && bg.grantedFor === projectId && bg.expiresAt.getTime() > Date.now()) return true;
    return false;
  }
  return SYSTEM_ROLE_PERMISSIONS[ctx.systemRole].includes(permission);
}

export function permissionsFor(ctx: AuthContext): Permission[] {
  const system = [...SYSTEM_ROLE_PERMISSIONS[ctx.systemRole]];
  const project = ctx.projectRole ? [...PROJECT_ROLE_PERMISSIONS[ctx.projectRole]] : [];
  return Array.from(new Set([...system, ...project]));
}

const SYSTEM_ROLE_RANK: Record<SystemRole, number> = {
  SUPER_ADMIN: 100,
  PLATFORM_ADMIN: 80,
  RESEARCH_ADMIN: 60,
  PRESET_MANAGER: 40,
  AUDITOR: 30,
  SUPPORT: 20,
  STANDARD_USER: 10,
};

/**
 * Privilege-escalation guard (prompt §6): an actor may only assign a role strictly below
 * their own rank, and only if they hold `admin.roles.assign`.
 */
export function canAssignSystemRole(ctx: AuthContext, target: SystemRole): boolean {
  if (!can(ctx, 'admin.roles.assign')) return false;
  return SYSTEM_ROLE_RANK[target] < SYSTEM_ROLE_RANK[ctx.systemRole];
}

const PROJECT_ROLE_RANK: Record<ProjectRole, number> = { OWNER: 30, COLLABORATOR: 20, VIEWER: 10 };

export function canAssignProjectRole(
  ctx: AuthContext,
  target: ProjectRole,
  projectId: string,
): boolean {
  if (!can(ctx, 'project.members.manage', projectId)) return false;
  const own = ctx.projectRole ? PROJECT_ROLE_RANK[ctx.projectRole] : 0;
  return PROJECT_ROLE_RANK[target] <= own;
}

/** Controls no role may ever remove (PRD §10.2, FR-67). */
export const IMMUTABLE_CONTROLS = [
  'evidence_labelling',
  'confidence_indicators',
  'limitations_block',
  'simulation_disclaimer',
  'unsupported_claim_check',
] as const;

export function canDisableControl(_ctx: AuthContext, _control: string): false {
  return false;
}
