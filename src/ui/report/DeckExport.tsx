'use client';

import { useEffect, useRef, useState } from 'react';
import { localize } from '@/ui/i18n/translate';

const BTN = 'inline-flex items-center gap-1.5 rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink hover:border-brand disabled:opacity-60';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the deck is in its final language and its text has been fitted. */
async function ready(rootId: string) {
  for (let i = 0; i < 120; i++) {
    if (document.getElementById(rootId)?.getAttribute('data-translating') !== 'true') break;
    await sleep(1000);
  }
  await document.fonts?.ready;
  await sleep(600);
}

/**
 * Download the deck as PowerPoint or PDF, exactly as it shows here: in the chosen language and with
 * the brand template, if one is applied. The PowerPoint has one full-bleed 16:9 picture per slide,
 * with the slide's text in its speaker notes; the PDF goes through the browser's print dialog
 * ("Save as PDF"), one slide per page.
 */
export function DeckExport({ rootId, fileName, auto }: { rootId: string; fileName: string; auto?: 'pptx' | 'pdf' | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const started = useRef(false);

  const pptx = async () => {
    setBusy(localize('Preparing the slides…'));
    try {
      await ready(rootId);
      const [{ toPng }, { default: PptxGenJS }] = await Promise.all([import('html-to-image'), import('pptxgenjs')]);
      const deck = new PptxGenJS();
      deck.layout = 'LAYOUT_WIDE';
      deck.title = fileName;
      const slides = [...document.querySelectorAll<HTMLElement>(`#${rootId} .slide`)];
      for (const [i, el] of slides.entries()) {
        setBusy(localize(`Slide ${i + 1} of ${slides.length}…`));
        const png = await toPng(el, { width: 1280, height: 720, pixelRatio: 2, cacheBust: true, style: { transform: 'none', boxShadow: 'none' } });
        const slide = deck.addSlide();
        slide.addImage({ data: png, x: 0, y: 0, w: 13.333, h: 7.5 });
        const notes = el.innerText.replace(/\n{2,}/g, '\n').trim();
        if (notes) slide.addNotes(notes);
      }
      await deck.writeFile({ fileName: `${fileName}.pptx` });
      setBusy(null);
    } catch (e) {
      console.error('[report export] PowerPoint failed', e);
      setBusy(localize('The PowerPoint could not be made. Try again, or use PDF.'));
    }
  };

  const pdf = async () => {
    setBusy(localize('Preparing the slides…'));
    await ready(rootId);
    setBusy(null);
    window.print();
  };

  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    void (auto === 'pptx' ? pptx() : pdf());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {busy && <span role="status" className="text-xs text-ink-muted">{busy}</span>}
      <button type="button" className={BTN} disabled={Boolean(busy) && busy !== localize('The PowerPoint could not be made. Try again, or use PDF.')} onClick={() => void pptx()}>Download PowerPoint</button>
      <button type="button" className={BTN} onClick={() => void pdf()}>Download PDF</button>
    </div>
  );
}
