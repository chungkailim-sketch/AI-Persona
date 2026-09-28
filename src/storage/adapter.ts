/**
 * Object storage (prompt §18).
 *
 * Uploaded bytes never go in the database. They go to an adapter, keyed by a path that contains no
 * user-supplied filename — the original name is kept as metadata on `SourceFile`, where it is data
 * rather than part of a path that could traverse out of the store.
 *
 * The local adapter writes under `.storage/` and is refused in production by `loadEnv()`, because
 * a file that vanishes on redeploy is worse than no file: the dataset row would survive pointing at
 * nothing.
 */
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@/lib/env';

export interface StoredObject {
  key: string;
  byteSize: number;
  checksum: string;
}

export interface StorageAdapter {
  readonly name: string;
  put(prefix: string, bytes: Buffer): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const ROOT = path.join(process.cwd(), '.storage');

/** Keys are generated, never derived from user input, so traversal is not possible by construction. */
function newKey(prefix: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9/_-]/g, '');
  return `${safePrefix}/${randomUUID()}`;
}

function resolveLocal(key: string): string {
  const full = path.resolve(ROOT, key);
  // Belt and braces: even though keys are generated, a resolved path outside the root is refused.
  if (!full.startsWith(path.resolve(ROOT) + path.sep)) {
    throw new Error('Refusing to access a path outside the object store.');
  }
  return full;
}

class LocalDiskAdapter implements StorageAdapter {
  readonly name = 'local';

  async put(prefix: string, bytes: Buffer): Promise<StoredObject> {
    const key = newKey(prefix);
    const full = resolveLocal(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return {
      key,
      byteSize: bytes.byteLength,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(resolveLocal(key));
  }

  async remove(key: string): Promise<void> {
    await unlink(resolveLocal(key)).catch(() => undefined);
  }
}

class UnconfiguredAdapter implements StorageAdapter {
  constructor(readonly name: string) {}
  private fail(): never {
    throw new Error(
      `OBJECT_STORAGE_PROVIDER="${this.name}" is selected but no client for it is implemented in ` +
        'this build. Implement the adapter before deploying.',
    );
  }
  async put(): Promise<StoredObject> { this.fail(); }
  async get(): Promise<Buffer> { this.fail(); }
  async remove(): Promise<void> { this.fail(); }
}

/**
 * S3-compatible object storage — AWS S3, or a Railway bucket, R2 or MinIO through
 * `OBJECT_STORAGE_ENDPOINT` (path-style addressing, which those services expect).
 */
class S3Adapter implements StorageAdapter {
  readonly name = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const e = env();
    if (!e.OBJECT_STORAGE_BUCKET || !e.OBJECT_STORAGE_ACCESS_KEY_ID || !e.OBJECT_STORAGE_SECRET_ACCESS_KEY) {
      throw new Error('OBJECT_STORAGE_PROVIDER=s3 requires OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY.');
    }
    this.bucket = e.OBJECT_STORAGE_BUCKET;
    this.client = new S3Client({
      region: e.OBJECT_STORAGE_REGION || 'auto',
      endpoint: e.OBJECT_STORAGE_ENDPOINT || undefined,
      forcePathStyle: Boolean(e.OBJECT_STORAGE_ENDPOINT),
      credentials: { accessKeyId: e.OBJECT_STORAGE_ACCESS_KEY_ID, secretAccessKey: e.OBJECT_STORAGE_SECRET_ACCESS_KEY },
    });
  }

  async put(prefix: string, bytes: Buffer): Promise<StoredObject> {
    const key = newKey(prefix);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes }));
    return { key, byteSize: bytes.byteLength, checksum: createHash('sha256').update(bytes).digest('hex') };
  }

  async get(key: string): Promise<Buffer> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await out.Body!.transformToByteArray());
    } catch (e) {
      // Same shape as a missing local file, so callers treat "object gone" identically everywhere.
      if ((e as { name?: string }).name === 'NoSuchKey') throw Object.assign(new Error(`No stored object ${key}`), { code: 'ENOENT' });
      throw e;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
  }
}

let adapter: StorageAdapter | null = null;

export function storage(): StorageAdapter {
  if (adapter) return adapter;
  const provider = env().OBJECT_STORAGE_PROVIDER;
  adapter = provider === 'local' ? new LocalDiskAdapter() : provider === 's3' ? new S3Adapter() : new UnconfiguredAdapter(provider);
  return adapter;
}

/** Test seam. */
export function setStorageAdapter(a: StorageAdapter | null): void {
  adapter = a;
}
