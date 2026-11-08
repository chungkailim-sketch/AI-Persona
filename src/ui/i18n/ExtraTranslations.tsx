'use client';

import { useLayoutEffect } from 'react';
import { LANG_EVENT, registerTranslations } from './translate';

/**
 * Adds a page's own content translations (source → Chinese) to the interface translation, then
 * re-applies the current language so text already on the page is translated too.
 */
export function ExtraTranslations({ entries }: { entries: Record<string, string> }) {
  useLayoutEffect(() => {
    registerTranslations(entries);
    if (document.documentElement.dataset.lang === 'zh') window.dispatchEvent(new CustomEvent(LANG_EVENT, { detail: 'zh' }));
  }, [entries]);
  return null;
}
