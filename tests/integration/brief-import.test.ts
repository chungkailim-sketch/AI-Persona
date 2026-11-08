// @vitest-environment node
/**
 * Uploading a brief: the file is read (here a Word document), the mock model returns the brief as
 * Markdown plus the form fields, and the Brief, its hypotheses, the swarm set-up and the decision
 * guidance all follow from it.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER = 'test-pepper';
process.env.MODEL_PROVIDER = 'mock';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { db, resetDatabase, seedUser } from './helpers';
import type { SessionUser } from '../../src/auth/session';
import { setStorageAdapter, type StorageAdapter, type StoredObject } from '../../src/storage/adapter';
import { createProject } from '../../src/server/projects';
import { setModelProvider } from '../../src/model/client';
import { MockProvider } from '../../src/model/mock';
import { executeBriefImport, requestBriefImport, suggestedSwarm, type ImportContent } from '../../src/advice/briefImport';
import { JourneyRefused, latestBrief, DEFAULT_CATEGORIES } from '../../src/roundtable/service';

class MemoryStore implements StorageAdapter {
  readonly name = 'memory';
  private readonly files = new Map<string, Buffer>();
  async put(prefix: string, bytes: Buffer): Promise<StoredObject> {
    const key = `${prefix}/${randomUUID()}`;
    this.files.set(key, bytes);
    return { key, byteSize: bytes.byteLength, checksum: createHash('sha256').update(bytes).digest('hex') };
  }
  async get(key: string): Promise<Buffer> {
    const b = this.files.get(key);
    if (!b) throw new Error('missing');
    return b;
  }
  async remove(key: string): Promise<void> { this.files.delete(key); }
}
setStorageAdapter(new MemoryStore());
setModelProvider(new MockProvider());

const asSession = (u: { id: string; email: string; systemRole: string }): SessionUser => ({
  userId: u.id, email: u.email, displayName: null, systemRole: u.systemRole as SessionUser['systemRole'], sessionId: 'test',
});

async function docx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('brief upload', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('reads a Word brief into the Brief, its hypotheses and the swarm set-up', async () => {
    const owner = asSession(await seedUser(`bi-${randomUUID().slice(0, 8)}@example.com`));
    const { id: projectId } = await createProject(owner, { name: 'Brief import' });
    const bytes = await docx(['Client: a skincare brand from Shanghai.', 'Which categories would young adults try a Chinese brand in first?']);

    const { adviceId } = await requestBriefImport(owner, projectId, { name: 'brief.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes }, 'en');
    await expect(requestBriefImport(owner, projectId, { name: 'again.docx', type: '', bytes }, 'en')).rejects.toBeInstanceOf(JourneyRefused);

    const outcome = await executeBriefImport(adviceId);
    expect(outcome.status).toBe('COMPLETED');

    const advice = await db.advice.findUniqueOrThrow({ where: { id: adviceId } });
    const content = advice.content as unknown as ImportContent;
    expect(content.markdown).toContain('skincare brand from Shanghai');

    const brief = await latestBrief(projectId);
    expect(brief?.researchQuestion).toBe('Which categories would young adults try a Chinese brand in first?');
    expect(brief?.categories).toEqual(DEFAULT_CATEGORIES.en.slice(0, 6));
    expect(await db.hypothesis.count({ where: { briefId: brief!.id } })).toBe(1);

    expect((await suggestedSwarm(projectId))?.topic).toContain('lead with price or with quality');
    const checks = await db.decisionCheck.findMany({ where: { projectId }, select: { checkpoint: true } });
    expect(checks.map((c) => c.checkpoint).sort()).toEqual(['BRIEF', 'SWARM_SETUP']);
  });

  it('refuses an empty file and reports a file with no readable text', async () => {
    const owner = asSession(await seedUser(`bi-${randomUUID().slice(0, 8)}@example.com`));
    const { id: projectId } = await createProject(owner, { name: 'Brief import 2' });
    await expect(requestBriefImport(owner, projectId, { name: 'x.txt', type: 'text/plain', bytes: Buffer.alloc(0) }, 'en')).rejects.toBeInstanceOf(JourneyRefused);
    const { adviceId } = await requestBriefImport(owner, projectId, { name: 'x.bin', type: '', bytes: Buffer.from([0, 1, 2, 3, 0, 0, 0, 9, 0, 0]) }, 'en');
    const outcome = await executeBriefImport(adviceId);
    expect(outcome.status).toBe('FAILED');
    expect(outcome.reason).toMatch(/No readable text/);
  });
});
