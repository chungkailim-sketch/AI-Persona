/**
 * Gathering what a debate may use (server only).
 *
 * Evidence passes the same gate a run does: only dataset versions a person has cleared, only when
 * `buildEvidenceContext` agrees model processing is permitted, and never a column the field review
 * excluded. A dataset that fails the gate is skipped and named, not partially used.
 */
import { prisma } from '@/lib/prisma';
import { storage } from '@/storage/adapter';
import { parseCsv } from '@/ingest/parse';
import { assessUsability } from '@/ingest/pipeline';
import { readVersionTables } from '@/ingest/structured';
import { buildEvidenceContext, EvidenceRefused } from '@/model/context';
import { isLongSurveyTable } from '@/forecast/series';
import { mentionedRanges, selectEvidence, type LongTableInput, type SelectedEvidence } from './evidence';

export class DebateRefused extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join(' '));
    this.name = 'DebateRefused';
  }
}

export interface GatheredEvidence {
  sources: { datasetVersionId: string; name: string; used: boolean; reason: string | null }[];
  manifestHashes: string[];
  selected: SelectedEvidence;
  focusMatched: string[];
}

export const MISSING_FILES =
  "Its stored data files are missing from this installation's .storage folder (usually because the app " +
  'was moved or re-extracted without it). Copy the old .storage folder across, or upload the dataset again.';

export function isMissingFile(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT';
}

/** Columns the evidence reads. If the review excluded any of them, the table cannot be used. */
const REQUIRED = ['statement', 'response', 'segment', 'share'];

export async function gatherDebateEvidence(projectId: string, motion: string, focusRequested: string[]): Promise<GatheredEvidence> {
  const links = await prisma.projectDataset.findMany({
    where: { projectId, dataset: { deletedAt: null } },
    include: { dataset: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
  });
  const sources: GatheredEvidence['sources'] = [];
  const manifestHashes: string[] = [];
  const tables: LongTableInput[] = [];

  for (const l of links) {
    const v = l.dataset.versions[0];
    if (!v) continue;
    const name = l.dataset.name;
    const usable = await assessUsability(v.id);
    if (!usable.usable) {
      sources.push({ datasetVersionId: v.id, name, used: false, reason: 'Not cleared for use in step 1.' });
      continue;
    }
    try {
      const ctx = await buildEvidenceContext(v.id);
      manifestHashes.push(ctx.manifestHash);
    } catch (e) {
      if (e instanceof EvidenceRefused) {
        sources.push({ datasetVersionId: v.id, name, used: false, reason: e.reasons.join(' ') });
        continue;
      }
      throw e;
    }
    const excluded = await prisma.datasetField.findMany({
      where: { datasetVersionId: v.id, OR: [{ excluded: true }, { redacted: true }] },
      select: { name: true },
    });
    const blocked = REQUIRED.filter((c) => excluded.some((f) => f.name.trim().toLowerCase() === c));
    if (blocked.length > 0) {
      sources.push({ datasetVersionId: v.id, name, used: false, reason: `The field review excluded ${blocked.join(', ')}, which the debate needs.` });
      continue;
    }
    let long: Awaited<ReturnType<typeof readVersionTables>>;
    try {
      long = (await readVersionTables(v.id)).filter((t) => isLongSurveyTable(t.headers));
    } catch (e) {
      // The database row survives when the stored file does not — typically the app was moved or
      // re-extracted to a new folder without its `.storage` directory. Skip it and say so; one
      // missing dataset must not take the whole debate down with it.
      if (!isMissingFile(e)) throw e;
      sources.push({ datasetVersionId: v.id, name, used: false, reason: MISSING_FILES });
      continue;
    }
    if (long.length === 0) {
      sources.push({ datasetVersionId: v.id, name, used: false, reason: 'No survey long table (statement × response × segment × share) in this dataset.' });
      continue;
    }
    const questionText = await questionIndex(v.id).catch((e: unknown) => {
      if (isMissingFile(e)) return new Map<string, string>();
      throw e;
    });
    for (const t of long) tables.push({ source: name, headers: t.headers, rows: t.rows, questionText });
    sources.push({ datasetVersionId: v.id, name, used: true, reason: null });
  }

  if (!sources.some((s) => s.used)) {
    throw new DebateRefused([
      'No dataset in this project can be used: a debate needs a survey table that has been cleared in step 1 with model processing permitted.',
      ...sources.map((s) => `${s.name}: ${s.reason}`),
    ]);
  }

  const requested = focusRequested.length > 0 ? focusRequested : mentionedRanges(motion);
  const selected = selectEvidence(tables, { topic: motion, focusRequested: requested });
  return {
    sources,
    manifestHashes,
    selected,
    focusMatched: selected.focus.map((f) => f.matched).filter((s): s is string => Boolean(s)),
  };
}

async function questionIndex(datasetVersionId: string): Promise<Map<string, string>> {
  const t = await prisma.structuredTable.findFirst({ where: { datasetVersionId, kind: 'question_index' } });
  if (!t) return new Map();
  const table = parseCsv((await storage().get(t.storageKey)).toString('utf8'));
  const id = table.headers.indexOf('question_id');
  const text = table.headers.indexOf('question_text');
  return new Map(table.rows.map((r) => [r[id] ?? '', r[text] ?? '']));
}

/**
 * The project's simulation, summarised for the swarm: the chosen run, or the latest completed one.
 * Labelled as simulated wherever it appears, because it is.
 */
export async function simulationContext(projectId: string, runId: string | null): Promise<string | null> {
  const run = await prisma.run.findFirst({
    where: {
      projectId,
      ...(runId ? { id: runId } : {}),
      status: { in: ['COMPLETED', 'COMPLETED_WITH_WARNINGS'] },
      synthesis: { isNot: null },
    },
    orderBy: { completedAt: 'desc' },
    include: { synthesis: true, findings: { orderBy: { priorityScore: 'desc' }, take: 5 } },
  });
  if (!run?.synthesis) return null;
  return [
    `Run ${run.id.slice(-8)}${run.isMock ? ' (mock provider — placeholder content)' : ''}.`,
    `Direct answer: ${run.synthesis.directAnswer.slice(0, 600)}`,
    `Summary: ${run.synthesis.executiveSummary.slice(0, 800)}`,
    ...run.findings.map((f) => `- Finding (${f.classification ?? 'unclassified'}, evidence ${f.evidenceGrade.toLowerCase()}): ${f.claim.slice(0, 300)}`),
  ].join('\n');
}
