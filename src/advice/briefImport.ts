/**
 * Reading a client brief from an uploaded file (server only; the reading happens on the worker).
 *
 * Any format is accepted. Text is taken out of the file in code where the format allows (Word,
 * PowerPoint, Excel, OpenDocument, HTML, RTF, plain text); a PDF or an image of a brief is handed to
 * the AI model to read directly. The model returns the brief as a Markdown document plus the fields
 * the journey's forms need. Those fill in the Brief (as a new version where the current one is
 * locked), add the hypotheses to it, and pre-fill the agent swarm set-up; decision guidance on the
 * brief and on the swarm set-up is then requested so the team sees the recommended next step.
 */
import JSZip from 'jszip';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { storage } from '@/storage/adapter';
import { enqueue } from '@/queue/queue';
import { recordAudit } from '@/lib/audit';
import { callModel } from '@/model/client';
import { deriveSeed, type ModelAttachment } from '@/model/provider';
import { wrapUntrusted } from '@/model/context';
import type { SessionUser } from '@/auth/session';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { AuthorizationError } from '@/auth/guard';
import { availableMarkets, DEFAULT_CATEGORIES, DEFAULT_QUESTION, JourneyRefused, latestBrief } from '@/roundtable/service';
import { marketsMentioned } from '@/roundtable/selection';
import { BriefImport } from '@/roundtable/schemas';
import type { Lang } from '@/roundtable/engine';
import { recordCheckpoint } from '@/decision/checkpoints';

export const BRIEF_IMPORT_PROMPT_VERSION = '1.0.0';
export const BRIEF_MAX_BYTES = 15 * 1024 * 1024;
const MAX_TEXT = 120_000;

interface ImportOptions {
  storageKey: string;
  fileName: string;
  mimeType: string;
  language: Lang;
}

export interface ImportContent extends BriefImport {
  briefId: string;
  unmatchedMarkets: string[];
  notes: string[];
}

// ── Request ───────────────────────────────────────────────────────────────────

export async function requestBriefImport(user: SessionUser, projectId: string, file: { name: string; type: string; bytes: Buffer }, language: Lang) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.edit', projectId)) throw new AuthorizationError('project.edit', projectId);
  if (file.bytes.length === 0) throw new JourneyRefused(['The file is empty.']);
  if (file.bytes.length > BRIEF_MAX_BYTES) throw new JourneyRefused(['The file is larger than 15 MB. Save a smaller copy (for example, without images) and try again.']);
  const running = await prisma.advice.findFirst({ where: { projectId, kind: 'BRIEF_IMPORT', status: { in: ['QUEUED', 'RUNNING'] } }, select: { id: true } });
  if (running) throw new JourneyRefused(['A brief is already being read. Wait for it to finish.']);

  const stored = await storage().put(`brief-imports/${projectId}`, file.bytes);
  const fileName = file.name.replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 160) || 'brief';
  const advice = await prisma.advice.create({
    data: {
      projectId,
      kind: 'BRIEF_IMPORT',
      question: fileName,
      options: { storageKey: stored.key, fileName, mimeType: file.type.slice(0, 120), language } satisfies ImportOptions as object,
      createdById: user.userId,
    },
  });
  await enqueue({ kind: 'brief_import', input: { adviceId: advice.id }, idempotencyKey: `brief_import:${advice.id}`, maxAttempts: 1 });
  await recordAudit({ action: 'brief.imported', targetType: 'project', targetId: projectId, projectId, actorUserId: user.userId, actorEmail: user.email, reason: `Brief uploaded: ${fileName}` });
  return { adviceId: advice.id };
}

export async function latestBriefImport(projectId: string) {
  return prisma.advice.findFirst({ where: { projectId, kind: 'BRIEF_IMPORT' }, orderBy: { createdAt: 'desc' } });
}

/** The swarm set-up suggested by the latest brief that was read successfully, if any. */
export async function suggestedSwarm(projectId: string): Promise<BriefImport['swarm'] | null> {
  const a = await prisma.advice.findFirst({ where: { projectId, kind: 'BRIEF_IMPORT', status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
  const c = a?.content as unknown as ImportContent | null;
  return c?.swarm?.topic ? c.swarm : null;
}

// ── Reading the file ──────────────────────────────────────────────────────────

const IMAGE: Record<string, ModelAttachment['mediaType']> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

function sniff(bytes: Buffer, name: string): 'pdf' | 'zip' | ModelAttachment['mediaType'] | 'text' {
  const head = bytes.subarray(0, 12);
  if (head.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) return 'zip';
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return IMAGE[ext] ?? 'text';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Paragraph-aware text from Office/OpenDocument XML. */
function xmlText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<(w:tab|a:tab|text:tab)\b[^>]*\/>/g, '\t')
      .replace(/<\/(w:p|a:p|text:p|text:h|row|si)>/g, '\n')
      .replace(/<(w:br|a:br|text:line-break)\b[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function zipText(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  const byNumber = (re: RegExp) =>
    names.filter((n) => re.test(n)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0));
  const parts: string[] = [];
  const read = async (n: string) => xmlText(await zip.file(n)!.async('string'));
  if (zip.file('word/document.xml')) {
    for (const n of byNumber(/^word\/header\d*\.xml$/)) parts.push(await read(n));
    parts.push(await read('word/document.xml'));
    if (zip.file('word/footnotes.xml')) parts.push(await read('word/footnotes.xml'));
  } else if (names.some((n) => n.startsWith('ppt/slides/'))) {
    const slides = byNumber(/^ppt\/slides\/slide\d+\.xml$/);
    for (const [i, n] of slides.entries()) parts.push(`## Slide ${i + 1}\n${await read(n)}`);
    for (const n of byNumber(/^ppt\/notesSlides\/notesSlide\d+\.xml$/)) parts.push(`(Speaker notes) ${await read(n)}`);
  } else if (zip.file('xl/sharedStrings.xml')) {
    parts.push(await read('xl/sharedStrings.xml'));
  } else if (zip.file('content.xml')) {
    parts.push(await read('content.xml'));
  } else {
    for (const n of names.filter((x) => /\.(xml|txt|md|html?)$/i.test(x)).slice(0, 50)) parts.push(await read(n));
  }
  return parts.filter(Boolean).join('\n\n');
}

/** Readable runs of text from a file of unknown or legacy binary format (.doc, .ppt, …). */
function printableRuns(bytes: Buffer): string {
  const utf16 = bytes.toString('utf16le').match(/[\p{L}\p{N}\p{P}\p{Zs}]{6,}/gu) ?? [];
  const latin = bytes.toString('latin1').match(/[\x20-\x7e]{6,}/g) ?? [];
  const best = utf16.join(' ').length > latin.join(' ').length ? utf16 : latin;
  return best.filter((r) => /[\p{L}]{3}/u.test(r)).join('\n');
}

function plainText(bytes: Buffer, name: string): string {
  const raw = bytes.toString('utf8');
  // Mostly undecodable: a binary format this module does not parse.
  if ((raw.match(/�|\u0000/g)?.length ?? 0) > raw.length * 0.05) return printableRuns(bytes);
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'rtf' || raw.startsWith('{\\rtf')) {
    return raw
      .replace(/\\par[d]?/g, '\n')
      .replace(/\{\\\*[^{}]*\}/g, '')
      .replace(/\\'[0-9a-f]{2}/gi, '')
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '')
      .replace(/\n[ \t]+/g, '\n')
      .trim();
  }
  if (/^(html?|xml|svg)$/.test(ext) || /^\s*<(!doctype|html)/i.test(raw)) {
    return decodeEntities(raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|h\d|li|tr)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
  }
  return raw.trim();
}

export async function readBriefFile(bytes: Buffer, name: string): Promise<{ text: string; attachments: ModelAttachment[] }> {
  const kind = sniff(bytes, name);
  if (kind === 'pdf') return { text: '', attachments: [{ mediaType: 'application/pdf', base64: bytes.toString('base64') }] };
  if (kind.startsWith('image/')) return { text: '', attachments: [{ mediaType: kind as ModelAttachment['mediaType'], base64: bytes.toString('base64') }] };
  const text = kind === 'zip' ? await zipText(bytes).catch(() => printableRuns(bytes)) : plainText(bytes, name);
  return { text: text.slice(0, MAX_TEXT), attachments: [] };
}

// ── Executing (worker) ────────────────────────────────────────────────────────

class ImportFailed extends Error {}

export async function executeBriefImport(adviceId: string): Promise<{ adviceId: string; status: string; reason?: string }> {
  const advice = await prisma.advice.findUnique({ where: { id: adviceId } });
  if (!advice) throw new Error(`Brief import ${adviceId} does not exist.`);
  if (advice.status === 'COMPLETED') return { adviceId, status: 'COMPLETED' };
  await prisma.advice.update({ where: { id: adviceId }, data: { status: 'RUNNING', failureReason: null } });
  const opts = advice.options as unknown as ImportOptions;
  const lang: Lang = opts.language === 'zh' ? 'zh' : 'en';
  try {
    const bytes = await storage().get(opts.storageKey);
    const file = await readBriefFile(bytes, opts.fileName);
    if (!file.attachments.length && file.text.replace(/\s/g, '').length < 20) {
      throw new ImportFailed('No readable text was found in this file. Upload the brief as a PDF, Word, PowerPoint or text file.');
    }
    const markets = await availableMarkets(advice.projectId);
    const r = await callModel({
      adviceId,
      stage: 'BRIEF_IMPORT',
      personaKey: 'brief-reader',
      system: [
        'You are a research director at a communications agency. You read a client brief and set up a simulated consumer study from it:',
        'personas built from published survey data answer a roundtable question by scoring categories, and an agent swarm of those',
        'personas debates a motion. You extract; you do not invent. Where the brief is silent, leave the field empty.',
        '',
        'Rules:',
        '1. "markdown": the whole brief as a clean, faithful Markdown document (headings, lists, tables), keeping every substantive point.',
        '2. "markets": only markets the brief names, spelled as in the list of markets in the data where one matches.',
        '3. "researchQuestion": one question the roundtable answers, phrased to consumers (e.g. "In the next year, which of these categories would you try a Chinese brand in?").',
        '4. "categories": 4–8 product or service categories the personas score, from the brief.',
        '5. "hypotheses": up to 4 falsifiable claims the brief implies, each with its null hypothesis and the minimum evidence that would support it.',
        '6. "swarm": the motion for the agent swarm debate (the decision the brief most needs tested), the hypothesis it rules on, two segments to compare where the brief names them (e.g. "18-24, 25-34"), and 1–3 rebuttal rounds.',
        `7. ${lang === 'zh' ? 'Write every text value in Simplified Chinese, except market names, which stay as in the data list.' : 'Write every text value in English.'}`,
        '8. Reply with a single JSON object in the shape you are given. No prose outside it.',
      ].join('\n'),
      attachments: file.attachments,
      messages: [
        {
          role: 'user',
          content: [
            `FILE NAME: ${opts.fileName}`,
            `MARKETS IN THE DATA: ${markets.join(' | ') || '(none uploaded yet)'}`,
            `DEFAULT CATEGORIES: ${DEFAULT_CATEGORIES[lang].join(' | ')}`,
            file.attachments.length ? 'The brief is the attached file.' : wrapUntrusted('client brief', file.text),
            '',
            'Respond with JSON: { "markdown": string, "title": string, "businessContext": string, "markets": string[], "researchQuestion": string, ' +
              '"categories": string[], "targetAudience": string, "objective": string, ' +
              '"hypotheses": [{ "label": string, "statement": string, "nullHypothesis": string, "minimumEvidenceThreshold": string }], ' +
              '"swarm": { "topic": string, "hypothesis": string, "focusSegments": string[], "rounds": number } }',
          ].join('\n'),
        },
      ],
      schemaName: 'brief_import',
      schema: BriefImport,
      seed: deriveSeed(1, 'brief_import', adviceId),
      budgetCapUsd: env().AI_RUN_BUDGET_USD,
      maxTokens: 12000,
      promptTemplate: 'advice.brief_import',
      promptVersion: BRIEF_IMPORT_PROMPT_VERSION,
    });
    if (!r.ok || !r.value) throw new ImportFailed(`The brief could not be read (${r.outcome}). Try again, or save it as a PDF or Word file.`);
    const v = r.value;

    // Markets: keep the ones the data has; name the rest so the team can add data for them.
    const matched = new Set<string>();
    const unmatched: string[] = [];
    for (const m of v.markets) {
      const hit = markets.find((x) => x.toLowerCase() === m.toLowerCase()) ?? marketsMentioned(m, markets)[0];
      if (hit) matched.add(hit);
      else unmatched.push(m);
    }
    const notes: string[] = [];
    const question = v.researchQuestion.length >= 10 ? v.researchQuestion : DEFAULT_QUESTION[lang];
    if (question !== v.researchQuestion) notes.push('The brief does not state a roundtable question; the default question was used.');
    const categories = v.categories.length >= 2 ? v.categories : DEFAULT_CATEGORIES[lang];
    if (categories !== v.categories) notes.push('The brief names fewer than two categories; the default categories were used.');

    const data = {
      businessContext: [v.title, v.businessContext].filter(Boolean).join('\n\n').slice(0, 3000) || null,
      researchQuestion: question,
      markets: [...matched],
      categories,
      targetAudience: v.targetAudience || null,
      objective: v.objective || null,
    };
    const latest = await latestBrief(advice.projectId);
    const brief = latest && latest.status !== 'LOCKED'
      ? await prisma.brief.update({ where: { id: latest.id }, data })
      : await prisma.brief.create({ data: { projectId: advice.projectId, versionNo: (latest?.versionNo ?? 0) + 1, createdById: advice.createdById, ...data } });
    if (v.hypotheses.length) {
      const existing = new Set((await prisma.hypothesis.findMany({ where: { briefId: brief.id }, select: { statement: true } })).map((h) => h.statement));
      for (const [i, h] of v.hypotheses.entries()) {
        if (existing.has(h.statement)) continue;
        await prisma.hypothesis.create({
          data: {
            briefId: brief.id,
            label: h.label || `H${i + 1}`,
            statement: h.statement,
            nullHypothesis: h.nullHypothesis || null,
            minimumEvidenceThreshold: h.minimumEvidenceThreshold || 'A clear majority of the personas, on bases of at least 30 respondents.',
            alternativeExplanations: [],
          },
        });
      }
    }
    const content: ImportContent = { ...v, researchQuestion: question, categories, briefId: brief.id, unmatchedMarkets: unmatched, notes };
    await prisma.advice.update({
      where: { id: adviceId },
      data: { status: 'COMPLETED', content: content as object, isMock: r.isMock, spendUsd: r.costUsd, completedAt: new Date() },
    });
    // Guidance on the brief and on the swarm set-up, so the recommended next step is ready.
    await recordCheckpoint(advice.projectId, 'BRIEF', advice.createdById).catch(() => null);
    await recordCheckpoint(advice.projectId, 'SWARM_SETUP', advice.createdById).catch(() => null);
    return { adviceId, status: 'COMPLETED' };
  } catch (e) {
    const reason = e instanceof ImportFailed ? e.message : e instanceof Error ? `The brief could not be read: ${e.message}` : 'The brief could not be read.';
    await prisma.advice.update({ where: { id: adviceId }, data: { status: 'FAILED', failureReason: reason.slice(0, 1000), completedAt: new Date() } });
    return { adviceId, status: 'FAILED', reason };
  }
}
