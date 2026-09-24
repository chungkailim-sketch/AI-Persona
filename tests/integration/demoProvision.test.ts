// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { db, resetDatabase } from './helpers';
import { resetEnvCache } from '../../src/lib/env';
import { provisionDemoWorkspace, DEMO_PROJECT_NAME } from '../../src/demo/provision';

/**
 * Provisioning is a convenience with sharp edges: it writes projects, datasets and cleared
 * governance records without anybody clicking anything. What is tested here is not that it works —
 * that is visible the moment you sign in — but that it refuses to work anywhere it should not.
 */
const BASE = {
  SESSION_SECRET: 'x'.repeat(48),
  DATABASE_URL: process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL!,
};

const KEYS = ['DEMO_SIGN_IN_EMAIL', 'DEMO_SIGN_IN_CODE', 'DEMO_DATASET_DIR', 'EMAIL_PROVIDER', 'OBJECT_STORAGE_PROVIDER', 'IP_HASH_PEPPER'];

function configure(over: Record<string, string>): void {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, BASE, over);
  resetEnvCache();
}

describe('demonstration workspace provisioning', () => {
  let dir: string;

  beforeEach(async () => {
    await resetDatabase();
    Object.assign(process.env, { NODE_ENV: 'test' });
    dir = await mkdtemp(path.join(tmpdir(), 'mintel-'));
  });

  afterAll(async () => {
    for (const k of KEYS) delete process.env[k];
    resetEnvCache();
    await db.$disconnect();
  });

  it('cannot even be configured in production — the process refuses to boot', async () => {
    // Stronger than "provisioning declines": a production deployment carrying DEMO_DATASET_DIR
    // never starts, so there is no running server on which this code could be reached.
    configure({
      NODE_ENV: 'production',
      DEMO_DATASET_DIR: dir,
      EMAIL_PROVIDER: 'postmark',
      OBJECT_STORAGE_PROVIDER: 's3',
      IP_HASH_PEPPER: 'a-real-pepper-value',
    });
    await expect(provisionDemoWorkspace()).rejects.toThrow(/not permitted in production/);
    expect(await db.project.count()).toBe(0);
    Object.assign(process.env, { NODE_ENV: 'test' });
  });

  it('declines in production even when the environment is otherwise valid', async () => {
    // The path that remains once the boot guard has nothing to catch: NODE_ENV is production and
    // no demonstration variables are set at all.
    configure({
      NODE_ENV: 'production',
      EMAIL_PROVIDER: 'postmark',
      OBJECT_STORAGE_PROVIDER: 's3',
      IP_HASH_PEPPER: 'a-real-pepper-value',
    });
    const out = await provisionDemoWorkspace();
    expect(out.status).toBe('skipped');
    expect(out.reason).toMatch(/production/i);
    expect(await db.project.count()).toBe(0);
    Object.assign(process.env, { NODE_ENV: 'test' });
  });

  it('does nothing without a demonstration credential', async () => {
    configure({ DEMO_DATASET_DIR: dir });
    const out = await provisionDemoWorkspace();
    expect(out.status).toBe('skipped');
    expect(out.reason).toMatch(/demonstration credential/i);
    expect(await db.project.count()).toBe(0);
  });

  it('does nothing when no dataset folder is named', async () => {
    configure({ DEMO_SIGN_IN_EMAIL: 'admin@rfcomms.com', DEMO_SIGN_IN_CODE: '010101' });
    const out = await provisionDemoWorkspace();
    expect(out.status).toBe('skipped');
    expect(out.reason).toMatch(/DEMO_DATASET_DIR/);
  });

  it('says so plainly when the folder cannot be read, rather than failing obscurely', async () => {
    configure({
      DEMO_SIGN_IN_EMAIL: 'admin@rfcomms.com',
      DEMO_SIGN_IN_CODE: '010101',
      DEMO_DATASET_DIR: path.join(dir, 'does-not-exist'),
    });
    await db.user.create({
      data: { email: 'admin@rfcomms.com', systemRole: 'SUPER_ADMIN', status: 'ACTIVE' },
    });
    const out = await provisionDemoWorkspace();
    expect(out.status).toBe('skipped');
    expect(out.reason).toMatch(/could not be read/i);
  });

  it('reports an empty folder instead of creating a project with nothing in it', async () => {
    configure({
      DEMO_SIGN_IN_EMAIL: 'admin@rfcomms.com',
      DEMO_SIGN_IN_CODE: '010101',
      DEMO_DATASET_DIR: dir,
    });
    await db.user.create({
      data: { email: 'admin@rfcomms.com', systemRole: 'SUPER_ADMIN', status: 'ACTIVE' },
    });
    await writeFile(path.join(dir, 'notes.txt'), 'not a databook');
    await writeFile(path.join(dir, 'unnamed-export.xlsx'), 'not a databook either');

    const out = await provisionDemoWorkspace();
    expect(out.status).toBe('skipped');
    expect(out.reason).toMatch(/No Mintel databooks/i);
    expect(await db.project.count()).toBe(0);
  });

  it('does not run twice', async () => {
    configure({
      DEMO_SIGN_IN_EMAIL: 'admin@rfcomms.com',
      DEMO_SIGN_IN_CODE: '010101',
      DEMO_DATASET_DIR: dir,
    });
    const user = await db.user.create({
      data: { email: 'admin@rfcomms.com', systemRole: 'SUPER_ADMIN', status: 'ACTIVE' },
    });
    const workspace = await db.workspace.create({ data: { name: 'Demo workspace' } });
    const project = await db.project.create({
      data: { name: DEMO_PROJECT_NAME, createdById: user.id, workspaceId: workspace.id },
    });

    const out = await provisionDemoWorkspace();
    expect(out.status).toBe('already-present');
    expect(out.projectId).toBe(project.id);
    expect(await db.project.count()).toBe(1);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });
});
