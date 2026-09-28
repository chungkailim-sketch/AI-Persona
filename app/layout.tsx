import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { HydrationMarker } from '@/ui/HydrationMarker';
import { currentSession } from '@/auth/session';
import { prisma } from '@/lib/prisma';
import { THEME_COOKIE, htmlThemeAttribute, parseThemePreference } from '@/ui/theme/theme';
import { LANG_COOKIE, parseLang } from '@/ui/i18n/translate';
import { LanguageRuntime } from '@/ui/i18n/LanguageRuntime';

export const metadata: Metadata = {
  title: 'Persona Intelligence',
  description: 'Evidence-grounded AI persona simulation and decision support',
};

/**
 * The theme is decided here, on the server, from the preference cookie — so the first byte of HTML
 * already carries the right `data-theme` and there is no flash of the wrong one. "System" renders
 * no attribute and the stylesheet's `prefers-color-scheme` query applies before first paint.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const cookie = jar.get(THEME_COOKIE)?.value;
  // The language is also decided here, so the page is marked for translation from the first byte.
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  // No cookie on this device yet: a signed-in user's stored preference still decides the first paint.
  let stored: string | undefined;
  if (!cookie) {
    const session = await currentSession().catch(() => null);
    if (session) {
      stored = (await prisma.user.findUnique({ where: { id: session.userId }, select: { themePreference: true } }).catch(() => null))?.themePreference;
    }
  }
  const pref = parseThemePreference(cookie ?? stored);
  return (
    <html lang={lang === 'zh' ? 'zh-CN' : 'en'} data-lang={lang} data-theme={htmlThemeAttribute(pref)} data-theme-preference={pref} suppressHydrationWarning>
      <body>
        <a href="#main" className="skip-link">Skip to main content</a>
        {children}
        <HydrationMarker />
        <LanguageRuntime initial={lang} />
      </body>
    </html>
  );
}
