import { describe, it, expect } from 'vitest';
import {
  can, canAssignSystemRole, canAssignProjectRole, permissionsFor, canDisableControl,
  type AuthContext,
} from '@/auth/permissions';

const base = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'u1', email: 'a@example.com', systemRole: 'STANDARD_USER', ...over,
});

describe('project-scoped permissions', () => {
  it('denies project access without membership', () => {
    expect(can(base(), 'project.view', 'p1')).toBe(false);
  });

  it('grants by project role', () => {
    expect(can(base({ projectRole: 'VIEWER' }), 'project.view', 'p1')).toBe(true);
    expect(can(base({ projectRole: 'VIEWER' }), 'simulation.run', 'p1')).toBe(false);
    expect(can(base({ projectRole: 'COLLABORATOR' }), 'simulation.run', 'p1')).toBe(true);
    expect(can(base({ projectRole: 'COLLABORATOR' }), 'project.members.manage', 'p1')).toBe(false);
    expect(can(base({ projectRole: 'OWNER' }), 'project.members.manage', 'p1')).toBe(true);
  });

  it('requires a projectId for project-scoped permissions', () => {
    expect(can(base({ projectRole: 'OWNER' }), 'project.view')).toBe(false);
  });

  // The separation that stops "admin" quietly meaning "reads every client's data".
  it('does NOT grant project data to a super admin by membership alone', () => {
    expect(can(base({ systemRole: 'SUPER_ADMIN' }), 'dataset.viewSensitive', 'p1')).toBe(false);
  });

  it('grants project access under an unexpired break-glass and denies an expired one', () => {
    const grant = { grantedFor: 'p1', reason: 'incident 42', expiresAt: new Date(Date.now() + 60_000) };
    expect(can(base({ systemRole: 'PLATFORM_ADMIN', breakGlass: grant }), 'project.view', 'p1')).toBe(true);
    expect(can(base({ systemRole: 'PLATFORM_ADMIN', breakGlass: grant }), 'project.view', 'p2')).toBe(false);
    const expired = { ...grant, expiresAt: new Date(Date.now() - 1) };
    expect(can(base({ systemRole: 'PLATFORM_ADMIN', breakGlass: expired }), 'project.view', 'p1')).toBe(false);
  });
});

describe('platform permissions', () => {
  it('gates the admin area by system role', () => {
    expect(can(base(), 'admin.access')).toBe(false);
    expect(can(base({ systemRole: 'AUDITOR' }), 'admin.access')).toBe(true);
    expect(can(base({ systemRole: 'AUDITOR' }), 'admin.users.manage')).toBe(false);
    expect(can(base({ systemRole: 'PLATFORM_ADMIN' }), 'admin.users.manage')).toBe(true);
  });

  it('keeps preset managers out of user management', () => {
    expect(can(base({ systemRole: 'PRESET_MANAGER' }), 'admin.presets.manage')).toBe(true);
    expect(can(base({ systemRole: 'PRESET_MANAGER' }), 'admin.users.manage')).toBe(false);
  });

  it('gives an auditor read access to the audit log but no configuration rights', () => {
    expect(can(base({ systemRole: 'AUDITOR' }), 'audit.view')).toBe(true);
    expect(can(base({ systemRole: 'AUDITOR' }), 'admin.prompts.manage')).toBe(false);
  });
});

describe('privilege escalation guard', () => {
  it('forbids assigning a role at or above your own rank', () => {
    const platform = base({ systemRole: 'PLATFORM_ADMIN' });
    // Strictly below is allowed; a peer or anyone above is not.
    expect(canAssignSystemRole(platform, 'RESEARCH_ADMIN')).toBe(true);
    expect(canAssignSystemRole(platform, 'PLATFORM_ADMIN')).toBe(false);
    expect(canAssignSystemRole(platform, 'SUPER_ADMIN')).toBe(false);

    const superAdmin = base({ systemRole: 'SUPER_ADMIN' });
    expect(canAssignSystemRole(superAdmin, 'PLATFORM_ADMIN')).toBe(true);
    // Not even a super admin may mint another super admin from the interface.
    expect(canAssignSystemRole(superAdmin, 'SUPER_ADMIN')).toBe(false);
  });

  it('forbids assigning any role without the permission, whatever the rank gap', () => {
    const support = base({ systemRole: 'SUPPORT' });
    expect(canAssignSystemRole(support, 'STANDARD_USER')).toBe(false);
    const standard = base({ systemRole: 'STANDARD_USER' });
    expect(canAssignSystemRole(standard, 'STANDARD_USER')).toBe(false);
  });

  it('forbids granting a project role above your own', () => {
    const collab = base({ projectRole: 'COLLABORATOR' });
    expect(canAssignProjectRole(collab, 'OWNER', 'p1')).toBe(false);
    const owner = base({ projectRole: 'OWNER' });
    expect(canAssignProjectRole(owner, 'COLLABORATOR', 'p1')).toBe(true);
    expect(canAssignProjectRole(owner, 'OWNER', 'p1')).toBe(true);
  });
});

describe('immutable controls', () => {
  it('lets no role disable evidence labelling or caveats', () => {
    for (const role of ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'STANDARD_USER'] as const) {
      expect(canDisableControl(base({ systemRole: role }), 'limitations_block')).toBe(false);
    }
  });
});

describe('permissionsFor', () => {
  it('merges system and project permissions without duplicates', () => {
    const list = permissionsFor(base({ systemRole: 'RESEARCH_ADMIN', projectRole: 'OWNER' }));
    expect(new Set(list).size).toBe(list.length);
    expect(list).toContain('admin.presets.manage');
    expect(list).toContain('simulation.run');
  });
});
