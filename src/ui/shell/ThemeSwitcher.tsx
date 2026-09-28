'use client';
/**
 * Theme controls. The quick switch in the top bar toggles light ↔ dark; the settings page offers
 * all three preferences. Both write the same three places (DOM attribute now, cookie + localStorage
 * immediately, profile via the API) so the choice survives navigation, reload and a new device.
 */
import { useEffect, useState } from 'react';
import {
  THEME_LABEL,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  htmlThemeAttribute,
  resolveTheme,
  themeCookieString,
  toggledPreference,
  type ThemePreference,
} from '../theme/theme';
import { Icon } from '../components/Icon';
import { cn } from '../cn';

function systemDark(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);
}

export function applyThemePreference(pref: ThemePreference): void {
  const attr = htmlThemeAttribute(pref);
  const root = document.documentElement;
  if (attr) root.setAttribute('data-theme', attr);
  else root.removeAttribute('data-theme');
  root.setAttribute('data-theme-preference', pref);
  document.cookie = themeCookieString(pref);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // storage can be unavailable (private mode); the cookie still carries the choice
  }
}

export async function saveThemePreference(pref: ThemePreference, persistToProfile: boolean): Promise<boolean> {
  applyThemePreference(pref);
  if (!persistToProfile) return true;
  try {
    const res = await fetch('/api/me/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preference: pref }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function useSystemDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    setDark(mq.matches);
    const on = () => setDark(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return dark;
}

export function ThemeSwitcher({ initialPreference, persistToProfile = true }: { initialPreference: ThemePreference; persistToProfile?: boolean }) {
  const [pref, setPref] = useState<ThemePreference>(initialPreference);
  const sysDark = useSystemDark();
  const resolved = resolveTheme(pref, sysDark);
  const next = resolved === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => {
        const n = toggledPreference(pref, systemDark());
        setPref(n);
        void saveThemePreference(n, persistToProfile);
      }}
      className="inline-flex h-8 w-8 items-center justify-center rounded border border-line text-ink-muted hover:border-line-strong hover:text-ink"
      aria-label={`Theme: ${resolved}${pref === 'system' ? ', following the system' : ''}. Switch to ${next} theme.`}
      title={`Theme: ${THEME_LABEL[pref]}${pref === 'system' ? ` (${resolved})` : ''} — switch to ${next}`}
      data-theme-toggle={resolved}
    >
      <Icon name={resolved === 'dark' ? 'moon' : 'sun'} size={16} />
    </button>
  );
}

/** The full three-way preference, for the settings page. */
export function ThemePreferenceControl({ initialPreference }: { initialPreference: ThemePreference }) {
  const [pref, setPref] = useState<ThemePreference>(initialPreference);
  const [status, setStatus] = useState<string>('');
  const sysDark = useSystemDark();

  return (
    <fieldset className="max-w-lg">
      <legend className="text-sm text-ink-muted">Appearance</legend>
      <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
        {THEME_PREFERENCES.map((p) => {
          const checked = pref === p;
          return (
            <label
              key={p}
              className={cn(
                'motion-color flex cursor-pointer flex-col items-center gap-1 rounded border px-3 py-3 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-brand',
                checked ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong bg-surface text-ink-muted hover:text-ink',
              )}
            >
              <input
                type="radio"
                name="theme"
                value={p}
                checked={checked}
                onChange={async () => {
                  setPref(p);
                  setStatus('Saving…');
                  const ok = await saveThemePreference(p, true);
                  setStatus(ok ? `Saved: ${THEME_LABEL[p]}.` : 'Applied on this device; could not save to your profile.');
                }}
                className="sr-only"
              />
              <Icon name={p === 'light' ? 'sun' : p === 'dark' ? 'moon' : 'monitor'} size={18} />
              <span>{THEME_LABEL[p]}</span>
              {p === 'system' && <span className="text-[11px] text-ink-subtle">now {sysDark ? 'dark' : 'light'}</span>}
            </label>
          );
        })}
      </div>
      <p className="mt-2 min-h-[1.25rem] text-xs text-ink-subtle" role="status" aria-live="polite">{status}</p>
    </fieldset>
  );
}
