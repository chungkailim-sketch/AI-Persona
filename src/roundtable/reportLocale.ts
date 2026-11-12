/**
 * The report deck in another language, all of it (server only).
 *
 * The deck page sends every piece of text on its slides — labels and content alike — and gets back
 * what is already translated for the chosen language. What is missing is translated once by the AI
 * model on the worker and stored (ContentTranslation, keyed by language and a hash of the text), so
 * the next viewer, and the PDF printed from the page, read entirely in that language. For Chinese the
 * interface dictionary answers first. Persona names, brand names and every figure stay as they are.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { enqueue } from '@/queue/queue';
import { callModel } from '@/model/client';
import { deriveSeed } from '@/model/provider';
import { translate } from '@/ui/i18n/translate';
import { list, text } from '@/debate/insightSchemas';

export const DECK_LANGUAGES = {
  en: { label: 'English', name: 'English' },
  zh: { label: '中文', name: 'Simplified Chinese' },
  id: { label: 'Bahasa Indonesia', name: 'Bahasa Indonesia' },
  vi: { label: 'Tiếng Việt', name: 'Vietnamese' },
  th: { label: 'ไทย', name: 'Thai' },
  fr: { label: 'Français', name: 'French' },
  pt: { label: 'Português', name: 'Portuguese' },
  es: { label: 'Español', name: 'Spanish' },
} as const;
export type DeckLang = keyof typeof DECK_LANGUAGES;
export const isDeckLang = (v: unknown): v is DeckLang => typeof v === 'string' && v in DECK_LANGUAGES;

const PROMPT_VERSION = '2.0.0';
const BATCH = 60;
const MAX_STRINGS = 3000;
const MAX_LENGTH = 2000;

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Strings worth translating: words, not bare figures, names of files or links. */
function clean(strings: unknown[]): string[] {
  const out = new Set<string>();
  for (const v of strings) {
    if (typeof v !== 'string') continue;
    const s = norm(v);
    if (s.length < 2 || s.length > MAX_LENGTH || !/\p{L}{2}/u.test(s) || /^https?:\/\//.test(s)) continue;
    out.add(s);
    if (out.size >= MAX_STRINGS) break;
  }
  return [...out];
}

/** What is already translated for `lang`, and what is still missing. */
export async function deckTranslations(lang: DeckLang, raw: unknown[]): Promise<{ entries: Record<string, string>; missing: string[] }> {
  const strings = clean(raw);
  if (lang === 'en' || !strings.length) return { entries: {}, missing: [] };
  const entries: Record<string, string> = {};
  const rest: string[] = [];
  for (const s of strings) {
    const t = lang === 'zh' ? translate(s) : null;
    if (t !== null && t !== s) entries[s] = t.trim();
    else rest.push(s);
  }
  for (let i = 0; i < rest.length; i += 500) {
    const part = rest.slice(i, i + 500);
    const rows = await prisma.contentTranslation.findMany({ where: { lang, sourceHash: { in: part.map(hash) } }, select: { source: true, text: true } });
    for (const r of rows) entries[r.source] = r.text;
  }
  return { entries, missing: rest.filter((s) => entries[s] === undefined) };
}

/** Queue the translation of what is missing; a no-op while one for this report and language runs. */
export async function requestDeckTranslation(projectId: string, roundtableId: string, lang: DeckLang, missing: string[]): Promise<void> {
  if (!missing.length || lang === 'en') return;
  const busy = await prisma.job.findFirst({
    where: { kind: 'report_translate', status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] }, AND: [{ input: { path: ['roundtableId'], equals: roundtableId } }, { input: { path: ['lang'], equals: lang } }] },
    select: { id: true },
  });
  if (busy) return;
  await enqueue({ kind: 'report_translate', input: { projectId, roundtableId, lang, strings: missing.slice(0, MAX_STRINGS) }, maxAttempts: 2 });
}

const Translated = z.object({ items: list(z.object({ id: text(10), text: text(4000) }), BATCH + 10) });

export async function executeReportTranslation(input: { projectId: string; roundtableId: string; lang?: string; strings?: unknown[] }): Promise<{ translated: number; failed: number }> {
  const lang: DeckLang = isDeckLang(input.lang) ? input.lang : 'zh';
  if (lang === 'en') return { translated: 0, failed: 0 };
  const { missing: todo } = await deckTranslations(lang, input.strings ?? []);
  const language = DECK_LANGUAGES[lang].name;
  let translated = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const res = await callModel({
      roundtableId: input.roundtableId,
      stage: 'REPORT_TRANSLATION',
      personaKey: 'translator',
      system: [
        `You translate the text of a market-research slide deck into ${language} for a client presentation.`,
        'Each item is one piece of text from a slide: a title, a label, a sentence, a table cell, a quote.',
        'Rules:',
        `1. Translate every item fully and naturally, as a professional research consultant writing in ${language} would. Keep the meaning, tone and every number exactly.`,
        '2. Keep personal names, brand names (Ruder Finn, rf.AI Persona, RF AI Persona, Mintel), retailer names and units as they are; express currencies naturally.',
        `3. Translate market and country names into their standard ${language} names.`,
        '4. Keep short labels short; keep any symbols (·, %, ≥, →, “ ”) where they are.',
        `5. An item already in ${language} is returned unchanged.`,
        '6. Reply with a single JSON object { "items": [{ "id": string, "text": string }] } with one entry per id. No prose outside it.',
      ].join('\n'),
      messages: [{ role: 'user', content: [`LANGUAGE: ${language}`, 'ITEMS:', ...batch.map((s, j) => `T${j + 1}: ${JSON.stringify(s)}`), `IDS: ${batch.map((_, j) => `T${j + 1}`).join(' | ')}`].join('\n') }],
      schemaName: 'report_translation',
      schema: Translated,
      seed: deriveSeed(1, 'report_translation', `${input.roundtableId}:${lang}:${i}`),
      budgetCapUsd: env().AI_RUN_BUDGET_USD,
      maxTokens: 12000,
      promptTemplate: 'roundtable.report_translation',
      promptVersion: PROMPT_VERSION,
    });
    if (!res.ok || !res.value) {
      failed += batch.length;
      continue;
    }
    for (const item of res.value.items) {
      const source = batch[Number(item.id.replace(/\D/g, '')) - 1];
      if (!source || !item.text) continue;
      await prisma.contentTranslation.upsert({
        where: { lang_sourceHash: { lang, sourceHash: hash(source) } },
        create: { lang, sourceHash: hash(source), source, text: item.text },
        update: { text: item.text },
      });
      translated++;
    }
  }
  return { translated, failed };
}
