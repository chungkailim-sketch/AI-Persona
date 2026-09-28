'use client';

import { useEffect } from 'react';
import { LANG_EVENT, translate, type Lang } from './translate';

/**
 * Applies the chosen interface language to the page, and keeps applying it as React updates it.
 *
 * It runs only after hydration, so React never sees translated text it did not render. It changes
 * the value of text nodes and a few attributes in place — never replaces a node — so React keeps
 * updating the same nodes; when it writes new English into one, the observer translates that too.
 * Switching back restores every original exactly.
 */
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'] as const;
const SKIP = 'script,style,noscript,textarea,pre,code,[data-no-translate],[contenteditable="true"]';

// Original English per node, and the value last written here (to tell our own writes apart from
// React's). Module-level on purpose: the root layout re-renders when the language cookie changes,
// and a record kept inside the component would be lost with it — switching back would then have
// nothing to restore.
const textOrig = new Map<Text, { orig: string; set: string }>();
const attrOrig = new Map<Element, Map<string, { orig: string; set: string }>>();
let titleOrig: { orig: string; set: string } | null = null;
let lang: Lang = 'en';
let started = false;

export function LanguageRuntime({ initial }: { initial: Lang }) {
  useEffect(() => {
    // One observer for the life of the page, whatever re-renders the layout.
    if (started) return;
    started = true;
    lang = initial;

    const skipped = (el: Element | null) => !el || Boolean(el.closest(SKIP));

    const doText = (node: Text) => {
      if (skipped(node.parentElement)) return;
      const value = node.nodeValue ?? '';
      const rec = textOrig.get(node);
      // Our own write coming back through the observer.
      if (rec && value === rec.set) return;
      const orig = value;
      if (lang === 'en') {
        if (rec) textOrig.delete(node);
        return;
      }
      const t = translate(orig);
      if (t === null) {
        textOrig.delete(node);
        return;
      }
      textOrig.set(node, { orig, set: t });
      node.nodeValue = t;
    };

    const doAttrs = (el: Element) => {
      if (skipped(el)) return;
      for (const a of ATTRS) {
        const value = el.getAttribute(a);
        if (value === null) continue;
        let recs = attrOrig.get(el);
        const rec = recs?.get(a);
        if (rec && value === rec.set) continue;
        if (lang === 'en') continue;
        const t = translate(value);
        if (t === null) continue;
        if (!recs) attrOrig.set(el, (recs = new Map()));
        recs.set(a, { orig: value, set: t });
        el.setAttribute(a, t);
      }
    };

    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      doAttrs(root as Element);
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let n: Node | null;
      while ((n = tw.nextNode())) {
        if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
        else doAttrs(n as Element);
      }
    };

    const doTitle = () => {
      if (titleOrig && document.title === titleOrig.set) return;
      const orig = document.title;
      const t = lang === 'zh' ? translate(orig) : null;
      if (t) {
        titleOrig = { orig, set: t };
        document.title = t;
      }
    };

    const restore = () => {
      for (const [node, rec] of textOrig) if (node.nodeValue === rec.set) node.nodeValue = rec.orig;
      for (const [el, recs] of attrOrig) for (const [a, rec] of recs) if (el.getAttribute(a) === rec.set) el.setAttribute(a, rec.orig);
      if (titleOrig && document.title === titleOrig.set) document.title = titleOrig.orig;
      textOrig.clear();
      attrOrig.clear();
      titleOrig = null;
    };

    const apply = (next: Lang) => {
      lang = next;
      document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
      document.documentElement.dataset.lang = next;
      if (next === 'en') restore();
      else {
        walk(document.body);
        doTitle();
      }
      document.documentElement.setAttribute('data-i18n-ready', '');
    };

    const observer = new MutationObserver((records) => {
      if (lang === 'en') return;
      for (const r of records) {
        if (r.type === 'characterData') doText(r.target as Text);
        else if (r.type === 'attributes') doAttrs(r.target as Element);
        else r.addedNodes.forEach(walk);
      }
      doTitle();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    const titleObserver = new MutationObserver(() => lang === 'zh' && doTitle());
    titleObserver.observe(document.head, { subtree: true, childList: true, characterData: true });

    const onSwitch = (e: Event) => apply((e as CustomEvent<Lang>).detail);
    window.addEventListener(LANG_EVENT, onSwitch);
    apply(lang);
    // Deliberately never torn down: the root layout lives as long as the page does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
