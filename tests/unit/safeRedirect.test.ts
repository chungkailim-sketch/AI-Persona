import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '@/lib/safeRedirect';

describe('open-redirect guard', () => {
  it('accepts an ordinary internal path', () => {
    expect(safeInternalPath('/projects/abc/data')).toBe('/projects/abc/data');
    expect(safeInternalPath('/settings?tab=sessions')).toBe('/settings?tab=sessions');
  });

  it('falls back when the value is absent or relative', () => {
    expect(safeInternalPath(null)).toBe('/dashboard');
    expect(safeInternalPath('')).toBe('/dashboard');
    expect(safeInternalPath('projects')).toBe('/dashboard');
  });

  it('rejects protocol-relative and scheme-bearing values', () => {
    // Browsers treat these as off-site, which is exactly the open redirect being prevented.
    expect(safeInternalPath('//evil.example')).toBe('/dashboard');
    expect(safeInternalPath('/\\evil.example')).toBe('/dashboard');
    expect(safeInternalPath('https://evil.example')).toBe('/dashboard');
    expect(safeInternalPath('/javascript:alert(1)')).toBe('/dashboard');
  });

  it('rejects header-splitting attempts', () => {
    expect(safeInternalPath('/ok\r\nSet-Cookie: x=1')).toBe('/dashboard');
  });
});
