// @vitest-environment node
/**
 * Uploading a GEO audit: the file is read, the metrics and the strategy come back from the mock
 * model, the gaps are computed in code, and the result feeds the plans' evidence and the report.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER = 'test-pepper';
process.env.MODEL_PROVIDER = 'mock';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { db, resetDatabase, seedUser } from './helpers';
import type { SessionUser } from '../../src/auth/session';
import { setStorageAdapter, type StorageAdapter, type StoredObject } from '../../src/storage/adapter';
import { createProject } from '../../src/server/projects';
import { setModelProvider } from '../../src/model/client';
import { MockProvider } from '../../src/model/mock';
import { completedGeoAudits, deleteGeoAudit, executeGeoAudit, geoEvidenceLines, listGeoAudits, requestGeoAudit } from '../../src/geo/audit';
import { projectContext } from '../../src/server/projectContext';

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

describe('GEO audit upload', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('reads an audit into metrics, computed gaps and a GEO strategy that the plans and the context use', async () => {
    const owner = asSession(await seedUser(`geo-${randomUUID().slice(0, 8)}@example.com`));
    const { id: projectId } = await createProject(owner, { name: 'GEO audit' });
    const text = 'AI Visibility Audit. Overall visibility 28.3%, rank #2 of 6. Mentions 26.4% vs Samsung 41.5%. Citation share 6.2%.';
    const { adviceId } = await requestGeoAudit(owner, projectId, { name: 'audit.txt', type: 'text/plain', bytes: Buffer.from(text) }, 'en');
    const out = await executeGeoAudit(adviceId);
    expect(out.status).toBe('COMPLETED');

    const [g] = await completedGeoAudits(projectId);
    expect(g!.metrics.headline.visibility).toBe(28.3);
    expect(g!.analysis.citationGap).toBe(20.2);
    expect(g!.strategy.channels.length).toBeGreaterThan(0);
    expect(geoEvidenceLines(g!)[0]).toContain('mention-to-citation gap');
    expect(await projectContext(projectId)).toContain('## GEO (AI visibility) audits');

    await deleteGeoAudit(owner, projectId, adviceId);
    expect(await listGeoAudits(projectId)).toHaveLength(0);
  });

  it('refuses an empty file', async () => {
    const owner = asSession(await seedUser(`geo-${randomUUID().slice(0, 8)}@example.com`));
    const { id: projectId } = await createProject(owner, { name: 'GEO audit' });
    await expect(requestGeoAudit(owner, projectId, { name: 'x.pdf', type: 'application/pdf', bytes: Buffer.alloc(0) }, 'en')).rejects.toThrow();
  });
});
