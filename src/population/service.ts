/**
 * Population samples (server only): read a dataset version's long survey table, build a seeded,
 * quota-controlled synthetic population from it, and store the specification, quotas, calibration
 * and a few rendered examples. Members themselves are not stored — the same (version, spec, seed)
 * rebuilds the same population, which is what makes a sample reproducible and auditable.
 */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { storage } from '@/storage/adapter';
import { parseFile } from '@/ingest/parse';
import { kindFromName } from '@/ingest/limits';
import { recordAudit } from '@/lib/audit';
import { isLongSurveyTable } from '@/forecast/series';
import { assessUsability } from '@/ingest/pipeline';
import { buildPopulation, type PopulationResult, type PopulationSpec } from './build';
import { cohortFromPopulation } from './cohort';
import { buildEvidenceContext } from '@/model/context';
import { persistCohort } from '@/server/personas';
import { emitTelemetry } from '@/telemetry/emit';

export const POPULATION_LIMITS = { minSize: 50, maxSize: 20_000 } as const;

export class PopulationRefused extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'PopulationRefused';
  }
}

/** Segment groups present in a version's long tables (for the form's choices). */
export async function populationGroups(datasetVersionId: string): Promise<string[]> {
  const t = await loadLongTable(datasetVersionId);
  if (!t) return [];
  const gi = t.headers.findIndex((h) => h.trim().toLowerCase() === 'segment_group');
  return [...new Set(t.rows.map((r) => r[gi] ?? '').filter(Boolean))].sort();
}

export async function loadLongTable(datasetVersionId: string): Promise<{ headers: string[]; rows: string[][] } | null> {
  const version = await prisma.datasetVersion.findUnique({ where: { id: datasetVersionId }, include: { files: true } });
  if (!version) return null;
  let headers: string[] | null = null;
  const rows: string[][] = [];
  for (const f of version.files) {
    const parsed = await parseFile(await storage().get(f.storageKey), kindFromName(f.originalName) ?? 'csv');
    for (const t of parsed.tables) {
      if (!isLongSurveyTable(t.headers)) continue;
      // Tables from different files may order columns differently; align on the first.
      if (!headers) headers = t.headers;
      const map = headers.map((h) => t.headers.indexOf(h));
      for (const r of t.rows) rows.push(map.map((i) => (i >= 0 ? (r[i] ?? '') : '')));
    }
  }
  return headers ? { headers, rows } : null;
}

export async function buildPopulationSample(
  user: SessionUser,
  projectId: string,
  datasetVersionId: string,
  spec: PopulationSpec,
): Promise<{ sampleId: string; result: PopulationResult }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'persona.create', projectId)) throw new AuthorizationError('persona.create', projectId);
  const linked = await prisma.datasetVersion.findFirst({
    where: { id: datasetVersionId, dataset: { projects: { some: { projectId } } } },
    select: { id: true },
  });
  if (!linked) throw new AuthorizationError('persona.create', projectId);

  const problems: string[] = [];
  if (!Number.isInteger(spec.size) || spec.size < POPULATION_LIMITS.minSize || spec.size > POPULATION_LIMITS.maxSize) {
    problems.push(`Population size must be a whole number from ${POPULATION_LIMITS.minSize} to ${POPULATION_LIMITS.maxSize.toLocaleString()}.`);
  }
  if (!Number.isInteger(spec.seed) || spec.seed < 0) problems.push('The seed must be a whole number of zero or more.');
  if (!spec.primaryGroup) problems.push('Choose the segment group to stratify by.');
  if (spec.secondaryGroup && spec.secondaryGroup === spec.primaryGroup) problems.push('The second group must differ from the first.');
  if (problems.length) throw new PopulationRefused(problems);
  const usable = await assessUsability(datasetVersionId);
  if (!usable.usable) throw new PopulationRefused(['This dataset has not been cleared in step 1:', ...usable.blockers]);

  const table = await loadLongTable(datasetVersionId);
  if (!table) throw new PopulationRefused(['This version has no wave-by-wave survey table (segment, statement, response, base, share), so there are no observed distributions to sample from.']);

  let result: PopulationResult;
  try {
    result = buildPopulation(table.headers, table.rows, spec);
  } catch (e) {
    throw new PopulationRefused([e instanceof Error ? e.message : 'The population could not be built from this table.']);
  }

  const saved = await prisma.populationSample.create({
    data: {
      projectId,
      datasetVersionId,
      size: spec.size,
      seed: spec.seed,
      primaryGroup: spec.primaryGroup,
      secondaryGroup: spec.secondaryGroup ?? null,
      spec: { ...spec, wave: result.wave, segments: result.segments, statements: result.statements, removedCells: result.removedCells, rejectedDraws: result.rejectedDraws, members: result.members } as object,
      quotas: result.quotas as unknown as object,
      calibration: result.calibration as unknown as object,
      examples: result.examples as unknown as object,
      assumptions: result.assumptions,
      createdById: user.userId,
    },
  });
  await recordAudit({
    action: 'population.sample.built',
    targetType: 'populationSample',
    targetId: saved.id,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    reason: `Population of ${spec.size} (seed ${spec.seed}) stratified by ${spec.primaryGroup}${spec.secondaryGroup ? ` × ${spec.secondaryGroup}` : ''}`,
  });
  return { sampleId: saved.id, result };
}

export async function latestPopulationSample(user: SessionUser, projectId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);
  return prisma.populationSample.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } });
}

/**
 * A cohort whose personas are the population sample's largest cells, carrying each segment's
 * OBSERVED answer distributions and weighted by cell share. The population is rebuilt from the
 * stored spec and checked against the stored quotas, so a cohort can never silently come from a
 * different population than the one a reviewer saw.
 */
export async function createCohortFromPopulation(
  user: SessionUser,
  projectId: string,
  sampleId: string,
  input: { personaCount: number; name?: string },
): Promise<{ cohortId: string; personaCount: number; note: string; coveredShare: number }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'persona.create', projectId)) throw new AuthorizationError('persona.create', projectId);
  const sample = await prisma.populationSample.findFirst({ where: { id: sampleId, projectId } });
  if (!sample) throw new AuthorizationError('persona.create', projectId);
  if (!Number.isInteger(input.personaCount) || input.personaCount < 2 || input.personaCount > 60) {
    throw new PopulationRefused(['A cohort needs between 2 and 60 personas.']);
  }

  // The governance gate: throws EvidenceRefused if the version is no longer cleared.
  const context = await buildEvidenceContext(sample.datasetVersionId);
  const table = await loadLongTable(sample.datasetVersionId);
  if (!table) throw new PopulationRefused(['The source table for this population sample is no longer readable.']);
  const spec: PopulationSpec = { size: sample.size, seed: sample.seed, primaryGroup: sample.primaryGroup, secondaryGroup: sample.secondaryGroup };
  const pop = buildPopulation(table.headers, table.rows, spec);
  const stored = sample.quotas as { cell: string; members: number }[];
  const same = stored.length === pop.quotas.length && stored.every((q, i) => q.cell === pop.quotas[i]!.cell && q.members === pop.quotas[i]!.members);
  if (!same) throw new PopulationRefused(['The population rebuilt from this dataset no longer matches the stored sample. Build a new sample first.']);

  const { personas, note, coveredShare } = cohortFromPopulation(pop, {
    personaCount: input.personaCount,
    seed: sample.seed,
    datasetName: context.datasetName,
    primaryGroup: sample.primaryGroup,
    secondaryGroup: sample.secondaryGroup,
    size: sample.size,
  });
  const cohort = await persistCohort(user, projectId, {
    name: input.name?.trim() || `Population cohort — ${sample.primaryGroup}${sample.secondaryGroup ? ` × ${sample.secondaryGroup}` : ''} (${pop.wave})`,
    note,
    personas,
    populationSampleId: sample.id,
  });

  const base = { sourceType: 'cohort' as const, sourceId: cohort.id, projectId, cohortId: cohort.id };
  await emitTelemetry({ ...base, eventType: 'evidence.loaded', stage: 'evidence', status: 'completed', message: `Population sample loaded: ${sample.size.toLocaleString()} members from ${context.datasetName}, ${pop.wave}; quotas reproduced exactly.` });
  const observed = personas.reduce((s, p) => s + p.attributes.filter((a) => a.origin === 'OBSERVED').length, 0);
  await emitTelemetry({ ...base, eventType: 'cohort.stage', stage: 'generation', status: 'completed', message: `${personas.length} candidate(s) from the largest cells, covering ${Math.round(coveredShare * 1000) / 10}% of the population; ${observed} segment-level observed attributes.`, progressCurrent: personas.length, progressTotal: personas.length });
  await emitTelemetry({ ...base, eventType: 'cohort.ready', stage: 'approval', status: 'pending', message: 'Cohort ready. Waiting for a person with approval rights to approve it.' });

  await recordAudit({
    action: 'persona.cohort.generated',
    targetType: 'cohort',
    targetId: cohort.id,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: { populationSampleId: sample.id, datasetVersionId: sample.datasetVersionId, evidenceManifestHash: context.manifestHash, personaCount: personas.length, seed: sample.seed },
  });
  return { cohortId: cohort.id, personaCount: personas.length, note, coveredShare };
}
