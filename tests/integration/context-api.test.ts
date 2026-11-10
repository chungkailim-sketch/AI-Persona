// @vitest-environment node
/** The read-only context API: off without its token, refuses a wrong one, finds a project by name. */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER = 'test-pepper';
process.env.MODEL_PROVIDER = 'mock';
process.env.CONTEXT_API_TOKEN = 'context-token-for-tests-0123456789abcdef';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, resetDatabase, seedUser } from './helpers';
import type { SessionUser } from '../../src/auth/session';
import { createProject } from '../../src/server/projects';
import { GET } from '../../app/api/context/route';

const asSession = (u: { id: string; email: string; systemRole: string }): SessionUser => ({
  userId: u.id, email: u.email, displayName: null, systemRole: u.systemRole as SessionUser['systemRole'], sessionId: 'test',
});
const call = (project: string, token?: string) =>
  GET(new Request(`http://app/api/context?project=${encodeURIComponent(project)}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

describe('context API', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('answers only with the right token, and returns the project as Markdown', async () => {
    const owner = asSession(await seedUser(`ctx-${randomUUID().slice(0, 8)}@example.com`));
    const { id } = await createProject(owner, { name: 'CBGA Outlook 2027' });
    await createProject(owner, { name: 'CBGA Outlook 2027 — draft' });

    expect((await call('CBGA Outlook 2027')).status).toBe(404);
    expect((await call('CBGA Outlook 2027', 'wrong')).status).toBe(404);

    const ok = await call('cbga outlook 2027', process.env.CONTEXT_API_TOKEN);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { project: { id: string }; markdown: string };
    expect(body.project.id).toBe(id);
    expect(body.markdown).toContain('# CBGA Outlook 2027');
    expect(body.markdown).toContain('## Brief');

    const several = await call('CBGA', process.env.CONTEXT_API_TOKEN);
    expect(several.status).toBe(300);
    expect(await db.auditEvent.count({ where: { action: 'project.context.read' } })).toBe(1);
  });
});
