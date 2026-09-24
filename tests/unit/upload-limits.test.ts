import { describe, it, expect } from 'vitest';
import nextConfig from '../../next.config';
import { UPLOAD_LIMITS } from '../../src/ingest/limits';

const toBytes = (v: string) => Number(/^(\d+)mb$/i.exec(v)![1]) * 1024 * 1024;

describe('request body limits', () => {
  it('let a full-size upload reach the server-side checks', () => {
    // Found in an end-to-end run: a 14.6MB Mintel CSV failed with a bare 413 because the
    // framework defaults (1MB server action, 10MB proxy) sat below the 25MB the product promises.
    const exp = nextConfig.experimental as { serverActions: { bodySizeLimit: string }; proxyClientMaxBodySize: string };
    expect(toBytes(exp.serverActions.bodySizeLimit)).toBeGreaterThan(UPLOAD_LIMITS.maxRequestBytes);
    expect(toBytes(exp.proxyClientMaxBodySize)).toBeGreaterThan(UPLOAD_LIMITS.maxRequestBytes);
    expect(UPLOAD_LIMITS.maxRequestBytes).toBeGreaterThanOrEqual(UPLOAD_LIMITS.maxBytes);
  });
});
