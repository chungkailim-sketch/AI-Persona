'use client';

import { useEffect, useState } from 'react';
import { LANG_COOKIE, LANG_EVENT, parseLang, type Lang } from './translate';

function currentLang(): Lang {
  return parseLang(typeof document === 'undefined' ? null : document.documentElement.dataset.lang);
}

/**
 * One click switches the whole interface between English and Simplified Chinese. The choice is kept
 * in a cookie for a year, so the next page (and the next visit) opens in the same language.
 *
 * The button's own text is marked not-to-translate: it always names the language it switches TO.
 */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const [lang, setLang] = useState<Lang>('en');
  useEffect(() => setLang(currentLang()), []);

  const toggle = () => {
    const next: Lang = lang === 'zh' ? 'en' : 'zh';
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: next }));
    setLang(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      data-no-translate
      data-lang-switch
      lang={lang === 'zh' ? 'en' : 'zh'}
      aria-label={lang === 'zh' ? 'Switch to English' : '切换到中文'}
      title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded border border-line px-2 text-[12px] font-medium text-ink-muted hover:border-line-strong hover:text-ink ${className}`}
    >
      {lang === 'zh' ? 'EN' : '中文'}
    </button>
  );
}
