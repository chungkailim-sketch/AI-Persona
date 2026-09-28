// @vitest-environment node
/**
 * Authorization enforced against a real database.
 *
 * These exercise the server modules the routes call, not the routes' UI. The point is that the
 * refusal comes from the server function itself — so hiding or showing a control in the interface
 * changes nothing about what is permitted.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER = 'test-pepper';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, resetDatabase, seedUser } from './helpers';
import type { SessionUser } from '../../src/auth/session';
import { createProject, listProjectsForUser, getProjectForUser } from '../../src/server/projects';
import { changeSystemRole, setUserStatus, addDomain, listAuditEvents } from '../../src/server/admin';
import { AuthorizationError } from '../../src/auth/guard';

function asSession(u: { id: string; email: string; systemRole: string }): SessionUser {
  return {
    userId: u.id,
    email: u.email,
    displayName: null,
    systemRole: u.systemRole as SessionUser['systemRole'],
    sessionId: 'test-session',
  };
}

describe('project isolation', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('shows a project only to its members', async () => {
    const owner = asSession(await seedUser('owner@example.com'));
    const stranger = asSession(await seedUser('stranger@example.com'));

    await createProject(owner, { name: 'Client work' });

    expect((await listProjectsForUser(owner)).map((p) => p.name)).toEqual(['Client work']);
    expect(await listProjectsForUser(stranger)).toEqual([]);
  });

  it('refuses a non-member direct access by id', async () => {
    const owner = asSession(await seedUser('owner2@example.com'));
    const stranger = asSession(await seedUser('stranger2@example.com'));
    const { id } = await createProject(owner, { name: 'Confidential' });

    await expect(getProjectForUser(stranger, id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(getProjectForUser(owner, id)).resolves.toBeTruthy();
  });

  it('gives a platform administrator no project access by virtue of the role', async () => {
    const owner = asSession(await seedUser('owner3@example.com'));
    const admin = asSession(await seedUser('admin3@example.com', 'SUPER_ADMIN'));
    const { id } = await createProject(owner, { name: 'Client data' });

    // This is the separation the PRD requires: administration is not a master key.
    expect(await listProjectsForUser(admin)).toEqual([]);
    await expect(getProjectForUser(admin, id)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('records project creation in the audit log', async () => {
    const owner = await seedUser('owner4@example.com');
    const auditor = asSession(await seedUser('auditor@example.com', 'AUDITOR'));
    await createProject(asSession(owner), { name: 'Audited project' });

    const events = await listAuditEvents(auditor);
    expect(events.map((e) => e.action)).toContain('project.created');
  });
});

describe('privilege escalation guards', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('refuses to grant a role at or above the actor’s own', async () => {
    const platformAdmin = asSession(await seedUser('pa@example.com', 'PLATFORM_ADMIN'));
    const target = await seedUser('target@example.com');

    await expect(
      changeSystemRole(platformAdmin, target.id, 'SUPER_ADMIN'),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      changeSystemRole(platformAdmin, target.id, 'PLATFORM_ADMIN'),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // Strictly below is permitted.
    await changeSystemRole(platformAdmin, target.id, 'RESEARCH_ADMIN');
    const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.systemRole).toBe('RESEARCH_ADMIN');
  });

  it('refuses a standard user any administrative action', async () => {
    const standard = asSession(await seedUser('std@example.com'));
    const target = await seedUser('victim@example.com');

    await expect(changeSystemRole(standard, target.id, 'SUPPORT')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(setUserStatus(standard, target.id, 'DEACTIVATED')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(addDomain(standard, 'evil.test')).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('refuses self role change in either direction', async () => {
    const admin = await seedUser('selfadmin@example.com', 'SUPER_ADMIN');
    const ctx = asSession(admin);
    await expect(changeSystemRole(ctx, admin.id, 'SUPPORT')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(setUserStatus(ctx, admin.id, 'DEACTIVATED')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('refuses to act on a peer of equal rank', async () => {
    const a = asSession(await seedUser('a-admin@example.com', 'PLATFORM_ADMIN'));
    const b = await seedUser('b-admin@example.com', 'PLATFORM_ADMIN');
    await expect(changeSystemRole(a, b.id, 'SUPPORT')).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('ends existing sessions when a role changes, so old authority does not linger', async () => {
    const superAdmin = asSession(await seedUser('sa@example.com', 'SUPER_ADMIN'));
    const target = await seedUser('rolechange@example.com', 'PLATFORM_ADMIN');
    await db.session.create({
      data: {
        userId: target.id,
        tokenHash: 'a'.repeat(64),
        idleExpiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await changeSystemRole(superAdmin, target.id, 'SUPPORT');

    const sessions = await db.session.findMany({ where: { userId: target.id } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it('ends existing sessions when an account is deactivated', async () => {
    const superAdmin = asSession(await seedUser('sa2@example.com', 'SUPER_ADMIN'));
    const target = await seedUser('deact@example.com');
    await db.session.create({
      data: {
        userId: target.id,
        tokenHash: 'b'.repeat(64),
        idleExpiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await setUserStatus(superAdmin, target.id, 'DEACTIVATED');

    const sessions = await db.session.findMany({ where: { userId: target.id } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(user.status).toBe('DEACTIVATED');
    expect(user.deactivatedAt).not.toBeNull();
  });
});

describe('approved domains', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('normalises and validates the domain', async () => {
    const admin = asSession(await seedUser('domadmin@example.com', 'PLATFORM_ADMIN'));
    await addDomain(admin, '  @Example.COM ');
    expect(await db.approvedDomain.findUnique({ where: { domain: 'example.com' } })).toBeTruthy();

    await expect(addDomain(admin, 'not a domain')).rejects.toThrow(/not a valid domain/);
    await expect(addDomain(admin, 'https://example.org')).rejects.toThrow(/not a valid domain/);
  });
});
