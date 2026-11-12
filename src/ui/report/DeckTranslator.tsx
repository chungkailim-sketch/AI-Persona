'use client';

import { useEffect, useState } from 'react';

/**
 * Shows the report deck in the chosen language: collects the text on the slides, asks the server for
 * the stored translations, writes them in place, and keeps asking while the rest is being translated.
 * Printing then prints the translated slides. The deck is marked not-to-translate for the interface
 * translation, so the two never write the same text.
 */
export function DeckTranslator({ projectId, lang, label, rootId }: { projectId: string; lang: string; label: string; rootId: string }) {
  const [pending, setPending] = useState<number | null>(lang === 'en' ? 0 : null);

  useEffect(() => {
    if (lang === 'en') return;
    const root = document.getElementById(rootId);
    if (!root) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const nodes: { node: Text; core: string; lead: string; trail: string }[] = [];
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = tw.nextNode())) {
      const t = n as Text;
      const v = t.nodeValue ?? '';
      const core = v.replace(/\s+/g, ' ').trim();
      if (!/\p{L}{2}/u.test(core) || t.parentElement?.closest('script,style')) continue;
      nodes.push({ node: t, core, lead: /^\s*/.exec(v)![0], trail: /\s*$/.exec(v)![0] });
    }
    const strings = [...new Set(nodes.map((x) => x.core))];
    const done = new Set<string>();

    const ask = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/report/translations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lang, strings: strings.filter((s) => !done.has(s)) }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { entries: Record<string, string>; missing: number };
        if (stopped) return;
        for (const x of nodes) {
          const tr = body.entries[x.core];
          if (tr !== undefined) {
            x.node.nodeValue = x.lead + tr + x.trail;
            done.add(x.core);
          }
        }
        setPending(body.missing);
        if (body.missing > 0) timer = setTimeout(ask, 4000);
      } catch {
        if (!stopped) timer = setTimeout(ask, 8000);
      }
    };
    void ask();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, lang, rootId]);

  if (pending === 0) return null;
  return (
    <p role="status" className="no-print mx-auto mt-4 max-w-[1320px] rounded border border-info/40 bg-info-soft px-4 py-2 text-sm text-ink">
      {pending === null ? (
        <><span>Loading the report in</span> <span data-no-translate>{label}</span>…</>
      ) : (
        <>
          <span>Translating the report into</span> <span data-no-translate>{label}</span>{': '}<span>{`${pending} item(s) to go.`}</span>{' '}
          <span>This page updates on its own; wait for it before saving the PDF.</span>
        </>
      )}
    </p>
  );
}
