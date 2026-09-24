/**
 * Demonstration workspace provisioning.
 *
 * What this exists for: a demonstration that begins on an empty "upload your data" screen shows
 * nothing. This walks the real Mintel databooks in `DEMO_DATASET_DIR` through the ordinary
 * pipeline — the same ingest, the same governance gate, the same cohort builder — so that by the
 * time anyone looks, the first three steps are genuinely complete rather than faked.
 *
 * It is a shortcut through the *clicking*, not through the *controls*. Every record it writes is
 * a record the application would have written anyway, made by the demonstration account, and the
 * governance acknowledgements it records name themselves as automated so that an audit read later
 * cannot mistake them for somebody's considered judgement.
 *
 * Three hard limits:
 *  - it does nothing when NODE_ENV is 'production';
 *  - it does nothing unless a demonstration credential is configured;
 *  - it runs once. A second call finds the project and returns, so a re-login does not duplicate
 *    a hundred megabytes of CSV.
 *
 * It deliberately stops before running the simulation. A run costs money when a real provider is
 * configured, and starting one nobody asked for is exactly the behaviour this application spends
 * the rest of its code preventing.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { env, demoSignIn } from '@/lib/env';
import type { SessionUser } from '@/auth/session';
import { createProject } from '@/server/projects';
import { createDatasetWithVersion } from '@/server/datasets';
import { recordGovernance, confirmFieldReview, acknowledgeFinding } from '@/server/governance';
import { getOrCreateBrief, saveBrief, addHypothesis } from '@/server/brief';
import { createCohort, approveCohort } from '@/server/personas';
import { runIngest } from '@/ingest/pipeline';
import { readMintelWorkbook, toCsv, monthIndex, parseFileName, type MintelRow } from '@/demo/mintel';

export const DEMO_PROJECT_NAME = 'CBGA Outlook 2027 — demonstration';

/**
 * Which demographic breaks to keep.
 *
 * A databook carries every cross of every break — "Gender and age" alone is thirty-odd segments,
 * and "Living situation" and "Pet ownership" another thirty between them. Keeping all of it
 * produces roughly a million rows across the twenty-nine files for no analytical gain in a
 * demonstration. These are the breaks the CBGA work actually reasons about.
 */
const KEPT_SEGMENT_GROUPS = new Set(
  [
    'all', 'region', 'gender', 'age groups', 'area',
    'monthly household income', 'net monthly household income', 'household income',
    'financial situation', 'employment', 'educational level', 'parental status',
  ].map((s) => s.toLowerCase()),
);

function keep(row: MintelRow): boolean {
  return KEPT_SEGMENT_GROUPS.has(row.segment_group.toLowerCase());
}

export interface ProvisionOutcome {
  status: 'created' | 'already-present' | 'skipped';
  reason?: string;
  projectId?: string;
  datasets?: number;
  files?: number;
  rows?: number;
  cohortId?: string;
  warnings?: string[];
}


/**
 * Ingest a version once, here and now.
 *
 * `createDatasetWithVersion` enqueues an ingest job, which is right for an upload made through the
 * browser. Provisioning cannot wait for a worker — it *is* running on the worker — and it needs the
 * fields to exist before it can record a field review. So the queued job is withdrawn and the
 * ingest run inline. Leaving both in place is not merely wasteful: the second ingest replaces the
 * field rows while the first caller is still holding their ids, and the field review then fails
 * with "a decision referred to a field that is not part of this dataset version".
 */
async function ingestNow(datasetVersionId: string, jobId: string): Promise<void> {
  await prisma.job
    .updateMany({
      where: { id: jobId, status: 'PENDING' },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        errorMessage: 'Superseded: ingested inline while preparing the demonstration workspace.',
      },
    })
    .catch(() => undefined);
  await runIngest(datasetVersionId, { correlationId: jobId });
}

export async function provisionDemoWorkspace(): Promise<ProvisionOutcome> {
  const e = env();
  if (e.NODE_ENV === 'production') {
    return { status: 'skipped', reason: 'Not available in production.' };
  }

  const demo = demoSignIn(e);
  if (!demo) {
    return { status: 'skipped', reason: 'No demonstration credential is configured.' };
  }

  const dir = e.DEMO_DATASET_DIR?.trim();
  if (!dir) {
    return { status: 'skipped', reason: 'DEMO_DATASET_DIR is not set, so there is nothing to preload.' };
  }

  const account = await prisma.user.findUnique({ where: { email: demo.email } });
  if (!account) return { status: 'skipped', reason: 'The demonstration account does not exist yet.' };

  const existing = await prisma.project.findFirst({
    where: { name: DEMO_PROJECT_NAME },
    select: { id: true },
  });
  if (existing) return { status: 'already-present', projectId: existing.id };

  const user: SessionUser = {
    userId: account.id,
    email: account.email,
    displayName: account.displayName ?? null,
    systemRole: account.systemRole,
    sessionId: 'demo-provisioning',
  };

  // ── Read the databooks ─────────────────────────────────────────────────────
  let entries: string[];
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) return { status: 'skipped', reason: `DEMO_DATASET_DIR is not a directory: ${dir}` };
    entries = await readdir(dir);
  } catch {
    return { status: 'skipped', reason: `DEMO_DATASET_DIR could not be read: ${dir}` };
  }

  const workbooks = entries
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'))
    .map((f) => ({ file: f, meta: parseFileName(f) }))
    .filter((x): x is { file: string; meta: NonNullable<ReturnType<typeof parseFileName>> } => x.meta !== null);

  if (workbooks.length === 0) {
    return { status: 'skipped', reason: `No Mintel databooks were found in ${dir}.` };
  }

  const warnings: string[] = [];
  // One table per market, with every wave in it.
  //
  // Not one file per wave: a dataset version's fields are profiled per file, so five wave files
  // produce five fields called "share", five called "response", and a persona card that lists each
  // attribute five times over. The wave is already a column, so a single longitudinal table per
  // market is both the tidier shape and the one that reads correctly on screen.
  const byMarket = new Map<string, { rows: MintelRow[]; sortKey: number }[]>();
  // question_id → { question wording, the markets and waves it appeared in }
  const questionIndex = new Map<string, { question: string; markets: Set<string>; waves: Set<string> }>();
  let totalRows = 0;

  for (const { file, meta } of workbooks) {
    const parsed = await readMintelWorkbook(path.join(dir, file), file);
    if (!parsed) {
      warnings.push(`${file}: the market and wave could not be read from the filename; skipped.`);
      continue;
    }
    for (const w of parsed.warnings) warnings.push(`${file}: ${w}`);

    const rows = parsed.rows.filter(keep);
    if (rows.length === 0) {
      warnings.push(`${file}: no rows survived the demographic filter; skipped.`);
      continue;
    }

    for (const [id, question] of parsed.questionText) {
      const entry = questionIndex.get(id) ?? { question, markets: new Set(), waves: new Set() };
      entry.markets.add(parsed.market);
      entry.waves.add(parsed.wave);
      questionIndex.set(id, entry);
    }

    const list = byMarket.get(parsed.market) ?? [];
    list.push({ rows, sortKey: meta.year * 100 + monthIndex(meta.month) });
    byMarket.set(parsed.market, list);
    totalRows += rows.length;
  }

  if (byMarket.size === 0) {
    return { status: 'skipped', reason: 'No databook produced any usable rows.', warnings };
  }

  // ── The project ────────────────────────────────────────────────────────────
  const { id: projectId } = await createProject(user, { name: DEMO_PROJECT_NAME });
  // Flag it. The "Demonstration data" label then belongs to this project rather than only to the
  // deployment, so a demonstration project that somehow travelled into a real one would still
  // announce itself.
  await prisma.project.update({ where: { id: projectId }, data: { isDemo: true } });

  const markets = [...byMarket.keys()].sort();
  const datasetVersionIds: string[] = [];
  let fileCount = 0;

  for (const market of markets) {
    const waves = byMarket.get(market)!.sort((a, b) => a.sortKey - b.sortKey);
    const combined = waves.flatMap((w) => w.rows);
    const ds = await createDatasetWithVersion(user, projectId, {
      name: `Mintel Global Consumer — ${market}`,
      files: [
        {
          originalName: `${market.replace(/\s+/g, '_')}_holistic_consumer_2024_2026.csv`,
          mimeType: 'text/csv',
          bytes: Buffer.from(toCsv(combined), 'utf8'),
        },
      ],
    });
    fileCount += waves.length;
    await ingestNow(ds.datasetVersionId, ds.jobId);
    datasetVersionIds.push(ds.datasetVersionId);

    // Governance, recorded honestly. Mintel publishes its methodology and base sizes on every
    // sheet, so these are the real answers rather than placeholders — but the *acknowledgement*
    // is automated, and says so, because nobody sat and read the findings.
    for (const f of await prisma.integrityFinding.findMany({
      where: { datasetVersionId: ds.datasetVersionId },
    })) {
      if (f.severity !== 'info') {
        await acknowledgeFinding(
          user,
          projectId,
          f.id,
          'Acknowledged automatically while preparing the demonstration workspace. Not a human review.',
        );
      }
    }

    await recordGovernance(user, projectId, ds.datasetVersionId, {
      dataOwner: 'Ruder Finn Asia',
      sourceName: `Mintel Global Consumer — The Holistic Consumer (${market})`,
      methodology:
        'Mintel/Kantar Profiles online panel, approximately 1,000 internet users per market per wave, ' +
        'quota sampled and weighted. Figures are published shares of each segment, not respondent-level ' +
        'records. One row per question, statement, response option and demographic segment, across every ' +
        'wave from 2024 to 2026. Question wording is in the "Mintel question index" dataset.',
      geography: [market],
      language: ['en'],
      lawfulBasis: 'LEGITIMATE_INTEREST',
      classification: 'CLIENT_CONFIDENTIAL',
      permittedUses: ['internal_analysis'],
      retentionDays: 365,
      allowModelProcessing: true,
    });

    const fields = await prisma.datasetField.findMany({
      where: { datasetVersionId: ds.datasetVersionId },
    });
    await confirmFieldReview(
      user,
      projectId,
      ds.datasetVersionId,
      fields.map((f) => ({
        fieldId: f.id,
        excluded: false,
        // "share" and "sample_base" are the measurements; every other column is a label that
        // identifies which measurement it is, which the schema calls a partial mapping.
        constructMappingGrade: (f.name === 'share' || f.name === 'sample_base'
          ? 'direct'
          : 'partial') as 'direct' | 'partial',
      })),
    );
  }

  // ── The question index ─────────────────────────────────────────────────────
  // The row tables identify a question by its id. This is where the wording lives, once, so the
  // verbatim question is always recoverable without carrying it on every row.
  if (questionIndex.size > 0) {
    const header = 'question_id,question,markets,waves';
    const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [...questionIndex.entries()]
      .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
      .map(([id, e]) =>
        [id, e.question, [...e.markets].sort().join('; '), [...e.waves].sort().join('; ')]
          .map(q)
          .join(','),
      );
    const qds = await createDatasetWithVersion(user, projectId, {
      name: 'Mintel question index',
      files: [
        {
          originalName: 'question_index.csv',
          mimeType: 'text/csv',
          bytes: Buffer.from([header, ...lines].join('\n'), 'utf8'),
        },
      ],
    });
    fileCount += 1;
    await ingestNow(qds.datasetVersionId, qds.jobId);
    await recordGovernance(user, projectId, qds.datasetVersionId, {
      dataOwner: 'Ruder Finn Asia',
      sourceName: 'Mintel Global Consumer — question wording',
      methodology:
        'The verbatim question text behind each question id in the market tables. Reference only; ' +
        'it contains no measurements and no respondent data.',
      geography: markets,
      language: ['en'],
      lawfulBasis: 'LEGITIMATE_INTEREST',
      classification: 'CLIENT_CONFIDENTIAL',
      permittedUses: ['internal_analysis'],
      retentionDays: 365,
      allowModelProcessing: true,
    });
    const qFields = await prisma.datasetField.findMany({
      where: { datasetVersionId: qds.datasetVersionId },
    });
    await confirmFieldReview(
      user,
      projectId,
      qds.datasetVersionId,
      qFields.map((f) => ({ fieldId: f.id, excluded: false, constructMappingGrade: 'direct' as const })),
    );
  }

  // ── The brief ──────────────────────────────────────────────────────────────
  const brief = await getOrCreateBrief(user, projectId);
  if (brief) {
    await saveBrief(user, projectId, brief.id, {
      researchQuestion:
        'Which of the six tracked markets shows the strongest movement towards holistic-wellbeing ' +
        'consumption between 2024 and 2026, and what is driving it?',
      objective: 'compare',
      decisionSupported:
        'Which markets the CBGA Outlook 2027 report should foreground, and which claims it can defend.',
      markets,
      competitors: [],
      desiredOutcome: '',
      exclusions: [],
      prohibitedInferences: [
        'Anything about an individual respondent — this evidence is aggregate and describes segments only.',
        'Health, medical or clinical inference of any kind.',
      ],
      personaCount: 8,
      runCount: 1,
      simulationDepth: 'standard',
    });
    await addHypothesis(user, projectId, brief.id, {
      label: 'H1',
      statement:
        'Agreement with future-focused and indulgence-balancing attitudes rose further in the ' +
        'emerging markets tracked than in the established ones between March 2024 and March 2026.',
      minimumEvidenceThreshold:
        'Two thirds of the simulated panel confirm, independent agreement above 0.7, no herding flagged, ' +
        'and the direction is consistent across at least three consecutive waves in the source data.',
      alternativeExplanations: [
        'Survey-mode and response-style differences between markets rather than a real attitude shift.',
        'Panel composition drift across waves.',
        'Translation effects on agree/disagree scales.',
      ],
    });
  }

  // ── The cohort ─────────────────────────────────────────────────────────────
  let cohortId: string | undefined;
  const firstVersion = datasetVersionIds[0];
  if (firstVersion) {
    const cohort = await createCohort(user, projectId, {
      datasetVersionId: firstVersion,
      personaCount: 8,
      seed: 2027,
      name: 'Holistic Consumer segments',
      // Segment on the demographic break rather than letting the heuristic choose. Left to itself
      // it picks whichever categorical column splits most evenly, which on a long-format survey
      // table is the question id — producing personas called "Q1" and "Q2", which describe nothing.
      segmentFieldName: 'segment',
    });
    await approveCohort(user, projectId, cohort.cohortId);
    cohortId = cohort.cohortId;
  }

  return {
    status: 'created',
    projectId,
    datasets: markets.length,
    files: fileCount,
    rows: totalRows,
    cohortId,
    warnings,
  };
}
