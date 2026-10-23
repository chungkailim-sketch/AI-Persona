// @vitest-environment node
process.env.DATABASE_URL ??= 'postgresql://x@localhost:5432/x';
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER ??= 'test-pepper';
import { describe, it, expect } from 'vitest';
import { storageFailure } from '../../src/ingest/pipeline';

describe('storageFailure', () => {
  it('names the S3 error and status without any message text', () => {
    expect(storageFailure({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 }, message: 'secret detail' })).toBe('AccessDenied, HTTP 403');
    expect(storageFailure(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT');
    expect(storageFailure(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }))).toBe('ENOTFOUND');
    expect(storageFailure('boom')).toBe('unknown error');
  });
});
