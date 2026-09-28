import { describe, it, expect } from 'vitest';
import { clientIp, userAgentHash } from '@/lib/request';

describe('client IP resolution', () => {
  it('takes the left-most forwarded entry, which the edge proxy appended', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' });
    expect(clientIp(h)).toBe('203.0.113.7');
  });

  it('ignores forged entries appended by the client', () => {
    // A client can add entries; it cannot remove the one the proxy prepends.
    const h = new Headers({ 'x-forwarded-for': '198.51.100.9, 192.0.2.99' });
    expect(clientIp(h)).toBe('198.51.100.9');
  });

  it('falls back to x-real-ip, then to null', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '192.0.2.5' }))).toBe('192.0.2.5');
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe('user agent hashing', () => {
  it('never returns the raw value and is stable for the same input', () => {
    const h = new Headers({ 'user-agent': 'Mozilla/5.0 Test' });
    const a = userAgentHash(h, 'pepper');
    expect(a).not.toContain('Mozilla');
    expect(a).toBe(userAgentHash(h, 'pepper'));
    expect(a).not.toBe(userAgentHash(h, 'other-pepper'));
  });

  it('returns null when there is no user agent', () => {
    expect(userAgentHash(new Headers(), 'pepper')).toBeNull();
  });
});
