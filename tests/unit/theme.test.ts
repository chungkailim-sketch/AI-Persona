import { describe, expect, it } from 'vitest';
import { htmlThemeAttribute, parseThemePreference, resolveTheme, themeCookieString, toggledPreference } from '../../src/ui/theme/theme';

describe('theme preference resolution', () => {
  it('accepts only the three preferences and falls back to system', () => {
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('purple')).toBe('system');
    expect(parseThemePreference(undefined)).toBe('system');
    expect(parseThemePreference(42)).toBe('system');
  });

  it('resolves system from the OS and explicit choices as themselves', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('toggles the resolved theme and stores an explicit choice', () => {
    expect(toggledPreference('system', true)).toBe('light');
    expect(toggledPreference('system', false)).toBe('dark');
    expect(toggledPreference('dark', false)).toBe('light');
    expect(toggledPreference('light', true)).toBe('dark');
  });

  it('renders no data-theme for system so the CSS media query decides before first paint', () => {
    expect(htmlThemeAttribute('system')).toBeUndefined();
    expect(htmlThemeAttribute('dark')).toBe('dark');
  });

  it('persists in a first-party, year-long, lax cookie', () => {
    const c = themeCookieString('dark');
    expect(c).toMatch(/^rfpi-theme=dark;/);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).toMatch(/Max-Age=31536000/);
  });
});
