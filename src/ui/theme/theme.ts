/**
 * Theme preference: light, dark or follow the operating system.
 *
 * Persistence, in order of authority:
 *  1. the signed-in user's profile (`User.themePreference`) — follows them to a new device;
 *  2. a first-party cookie, read by the server before rendering — which is what prevents a flash
 *     of the wrong theme, because the correct `data-theme` is in the very first byte of HTML and no
 *     script has to run first;
 *  3. `localStorage`, written alongside the cookie as an immediate client-side fallback.
 *
 * "System" is not stored as a resolved value: it is the absence of `data-theme`, and the CSS
 * `prefers-color-scheme` query does the rest, so an OS switch at dusk is followed without a reload.
 */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

export const THEME_COOKIE = 'rfpi-theme';
export const THEME_STORAGE_KEY = 'rfpi-theme';
export const NAV_COOKIE = 'rfpi-nav';

export function parseThemePreference(value: unknown): ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : 'system';
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** The quick switch toggles the *resolved* theme and stores the result as an explicit choice. */
export function toggledPreference(current: ThemePreference, systemPrefersDark: boolean): ThemePreference {
  return resolveTheme(current, systemPrefersDark) === 'dark' ? 'light' : 'dark';
}

/** The attribute the server renders on <html>. `undefined` means "follow the system". */
export function htmlThemeAttribute(preference: ThemePreference): ResolvedTheme | undefined {
  return preference === 'system' ? undefined : preference;
}

export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function themeCookieString(preference: ThemePreference): string {
  return `${THEME_COOKIE}=${preference}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export const THEME_LABEL: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};
