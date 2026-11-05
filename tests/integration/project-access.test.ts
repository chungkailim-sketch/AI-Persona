// @vitest-environment node
/**
 * A super administrator decides who has access to which project. Nobody else may, nobody may change
 * their own access, a project keeps an owner, and every change is audited.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER = 'test-pepper';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, resetDatabase, seedUser } from './helpers';
import type { SessionUser } from '../../src/auth/session';
import { createProject } from '../../src/server/projects';
import { setProjectAccess, listProjectAccess } from '../../src/server/admin';
import { AuthorizationError } from '../../src/auth/guard';

const asUser = (u: { id: string; email: string; systemRole: string }): SessionUser =>
  ({ userId: u.id, email: u.email, systemRole: u.systemRole, sessionId: `s-${u.id}` }) as unknown as SessionUser;

describe('project access', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  async function setup() {
    const root = await seedUser('root@example.com', 'SUPER_ADMIN');
    const owner = await seedUser('owner@example.com');
    const person = await seedUser('person@example.com');
    const { id: projectId } = await createProject(asUser(owner), { name: 'Client study' });
    return { root, owner, person, projectId };
  }

  it('grants, changes and removes access, and audits each change', async () => {
    const { root, person, projectId } = await setup();
    const actor = asUser(root);
    await setProjectAccess(actor, person.id, projectId, 'VIEWER');
    expect((await db.projectMember.findFirstOrThrow({ where: { userId: person.id, projectId } })).role).toBe('VIEWER');
    await setProjectAccess(actor, person.id, projectId, 'COLLABORATOR');
    expect((await db.projectMember.findFirstOrThrow({ where: { userId: person.id, projectId } })).role).toBe('COLLABORATOR');
    await setProjectAccess(actor, person.id, projectId, null);
    expect(await db.projectMember.count({ where: { userId: person.id, projectId } })).toBe(0);
    const actions = (await db.auditEvent.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } })).map((e) => e.action).filter((a) => a.startsWith('project.access'));
    expect(actions).toEqual(['project.access.granted', 'project.access.changed', 'project.access.revoked']);
  });

  it('is for super administrators only, and never for your own access', async () => {
    const { root, owner, person, projectId } = await setup();
    const admin = await seedUser('admin@example.com', 'PLATFORM_ADMIN');
    await expect(setProjectAccess(asUser(admin), person.id, projectId, 'VIEWER')).rejects.toBeInstanceOf(AuthorizationError);
    await expect(setProjectAccess(asUser(owner), person.id, projectId, 'VIEWER')).rejects.toBeInstanceOf(AuthorizationError);
    await expect(setProjectAccess(asUser(root), root.id, projectId, 'OWNER')).rejects.toThrow(/own project access/);
    expect(await listProjectAccess(asUser(admin))).toBeNull();
    const all = await listProjectAccess(asUser(root));
    expect(all!.projects.map((p) => p.name)).toEqual(['Client study']);
  });

  it('keeps at least one owner and refuses a deactivated account', async () => {
    const { root, owner, person, projectId } = await setup();
    await expect(setProjectAccess(asUser(root), owner.id, projectId, 'VIEWER')).rejects.toThrow(/at least one owner/);
    await expect(setProjectAccess(asUser(root), owner.id, projectId, null)).rejects.toThrow(/at least one owner/);
    await setProjectAccess(asUser(root), person.id, projectId, 'OWNER');
    await setProjectAccess(asUser(root), owner.id, projectId, 'VIEWER');
    const gone = await seedUser('gone@example.com', 'STANDARD_USER', 'DEACTIVATED');
    await expect(setProjectAccess(asUser(root), gone.id, projectId, 'VIEWER')).rejects.toThrow(/deactivated/);
  });
});
