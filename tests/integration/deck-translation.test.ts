// @vitest-environment node
/** The report deck in another language: stored translations returned, missing ones translated once. */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER = 'test-pepper';
process.env.MODEL_PROVIDER = 'mock';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, resetDatabase, seedUser } from './helpers';
import type { SessionUser } from '../../src/auth/session';
import { createProject } from '../../src/server/projects';
import { setModelProvider } from '../../src/model/client';
import { MockProvider } from '../../src/model/mock';
import { deckTranslations, executeReportTranslation, requestDeckTranslation } from '../../src/roundtable/reportLocale';

setModelProvider(new MockProvider());
const asSession = (u: { id: string; email: string; systemRole: string }): SessionUser => ({
  userId: u.id, email: u.email, displayName: null, systemRole: u.systemRole as SessionUser['systemRole'], sessionId: 'test',
});

describe('deck translation', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('translates the slide text once per language and reuses it', async () => {
    const owner = asSession(await seedUser(`dt-${randomUUID().slice(0, 8)}@example.com`));
    const { id: projectId } = await createProject(owner, { name: 'Deck' });
    const cohort = await db.cohort.create({ data: { projectId, name: 'Cast', kind: 'cast' } });
    const rt = await db.roundtable.create({ data: { projectId, cohortId: cohort.id, question: 'Q?', categories: [], seed: 1, status: 'COMPLETED', createdById: owner.userId } });

    const strings = ['Key takeaways', 'Openness by market', '74', 'Openness by market'];
    expect(await deckTranslations('en', strings)).toEqual({ entries: {}, missing: [] });

    const first = await deckTranslations('fr', strings);
    expect(first.missing).toEqual(['Key takeaways', 'Openness by market']);
    await requestDeckTranslation(projectId, rt.id, 'fr', first.missing);
    await requestDeckTranslation(projectId, rt.id, 'fr', first.missing);
    const job = await db.job.findMany({ where: { kind: 'report_translate' } });
    expect(job).toHaveLength(1);

    const out = await executeReportTranslation(job[0]!.input as { projectId: string; roundtableId: string; lang: string; strings: string[] });
    expect(out).toEqual({ translated: 2, failed: 0 });
    const again = await deckTranslations('fr', strings);
    expect(again.missing).toEqual([]);
    expect(again.entries['Key takeaways']).toBe('[French] Key takeaways');

    // Chinese answers from the interface dictionary first.
    const zh = await deckTranslations('zh', ['Key takeaways']);
    expect(zh.entries['Key takeaways']).toMatch(/[\u4e00-\u9fff]/);
    expect(zh.missing).toEqual([]);
  });
});
