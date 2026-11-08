/**
 * The report in Chinese, all of it (server only).
 *
 * Interface wording on the slides is translated by the interface dictionary. What the dictionary
 * cannot hold is the report's own content: the model's quotes, takeaways and advice (written in the
 * language the roundtable ran in), the survey statements and answer labels, the categories, segment
 * and income labels, occupations and cities. When the report is opened in Chinese, those strings are
 * translated once by the AI model on the worker and stored (ContentTranslation); the page passes them
 * to the interface translation, so the deck — and the PDF printed from it — reads in Chinese.
 * Persona names stay as written; every figure is untouched.
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
import { loadReport, type Report } from './report';

const PROMPT_VERSION = '1.0.0';
const BATCH = 60;
// Keys whose values are identifiers or proper names, never shown as translatable text.
const SKIP_KEYS = new Set(['id', 'personaId', 'statId', 'statIds', 'keyStatIds', 'headshot', 'name', 'refs', 'ref', 'key', 'tier', 'band', 'pillar', 'gender', 'roundtableId', 'cohortId']);

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

function collect(value: unknown, out: Set<string>, key = ''): void {
  if (SKIP_KEYS.has(key)) return;
  if (typeof value === 'string') {
    const s = value.replace(/\s+/g, ' ').trim();
    if (s.length >= 2 && s.length <= 2000 && /[A-Za-z]{2}/.test(s) && translate(s) === null && !/^https?:\/\//.test(s)) out.add(s);
    return;
  }
  if (Array.isArray(value)) for (const v of value) collect(v, out, key);
  else if (value && typeof value === 'object' && !(value instanceof Date)) for (const [k, v] of Object.entries(value)) collect(v, out, k);
}

/** Every piece of report content that is not interface wording and still reads in another language. */
export function reportStrings(r: Report): string[] {
  const out = new Set<string>();
  collect(
    {
      projectName: r.projectName,
      context: r.context,
      audience: r.audience,
      question: r.roundtable.question,
      categories: r.roundtable.categories,
      summary: r.summary,
      cast: r.cast.map((p) => ({ profile: p.profile, answer: p.answer })),
      markets: r.castMarkets,
      inputs: r.inputs,
    },
    out,
  );
  return [...out];
}

/** The stored Chinese for this report's content, and how many strings still need translating. */
export async function reportTranslations(r: Report): Promise<{ entries: Record<string, string>; missing: number }> {
  const strings = reportStrings(r);
  if (!strings.length) return { entries: {}, missing: 0 };
  const rows = await prisma.contentTranslation.findMany({ where: { lang: 'zh', sourceHash: { in: strings.map(hash) } }, select: { source: true, text: true } });
  const entries = Object.fromEntries(rows.map((x) => [x.source, x.text]));
  return { entries, missing: strings.filter((s) => entries[s] === undefined).length };
}

/** Queue the translation of whatever is missing; a no-op while one is already queued or running. */
export async function requestReportTranslation(projectId: string, roundtableId: string, missing: number): Promise<void> {
  const busy = await prisma.job.findFirst({ where: { kind: 'report_translate', status: { in: ['PENDING', 'CLAIMED', 'RUNNING'] }, input: { path: ['roundtableId'], equals: roundtableId } }, select: { id: true } });
  if (busy) return;
  // Keyed by what is missing, so a later change (a new takeaway) queues again but a reload does not.
  await enqueue({ kind: 'report_translate', input: { projectId, roundtableId }, idempotencyKey: `report_translate:${roundtableId}:${missing}:${new Date().toISOString().slice(0, 13)}`, maxAttempts: 2 });
}

const Translated = z.object({ items: list(z.object({ id: text(10), zh: text(4000) }), BATCH + 10) });

export async function executeReportTranslation(input: { projectId: string; roundtableId: string }): Promise<{ translated: number; failed: number }> {
  const r = await loadReport(input.projectId);
  if (!r) return { translated: 0, failed: 0 };
  const { entries } = await reportTranslations(r);
  const todo = reportStrings(r).filter((s) => entries[s] === undefined);
  let translated = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const res = await callModel({
      roundtableId: r.roundtable.id,
      stage: 'REPORT_TRANSLATION',
      personaKey: 'translator',
      system: [
        'You translate the content of a market-research report into Simplified Chinese for a client deck.',
        'Rules:',
        '1. Translate every item fully and naturally, as a professional Chinese research consultant would write it. Keep the meaning, tone and any numbers exactly.',
        '2. Keep brand names, retailer names, currencies and units as they are (e.g. "IDR 3-5 million" → "300万至500万印尼盾"; "Sephora" stays "Sephora").',
        '3. Translate market and country names into their standard Chinese names.',
        '4. An item that is already Chinese is returned unchanged.',
        '5. Reply with a single JSON object { "items": [{ "id": string, "zh": string }] } with one entry per id. No prose outside it.',
      ].join('\n'),
      messages: [{ role: 'user', content: ['ITEMS:', ...batch.map((s, j) => `T${j + 1}: ${JSON.stringify(s)}`), `IDS: ${batch.map((_, j) => `T${j + 1}`).join(' | ')}`].join('\n') }],
      schemaName: 'report_translation',
      schema: Translated,
      seed: deriveSeed(1, 'report_translation', `${r.roundtable.id}:${i}`),
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
      if (!source || !item.zh) continue;
      await prisma.contentTranslation.upsert({
        where: { lang_sourceHash: { lang: 'zh', sourceHash: hash(source) } },
        create: { lang: 'zh', sourceHash: hash(source), source, text: item.zh },
        update: { text: item.zh },
      });
      translated++;
    }
  }
  return { translated, failed };
}
