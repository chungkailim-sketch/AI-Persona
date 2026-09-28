/**
 * Cohort generation.
 *
 * A persona here is a *summary of a segment in the data*, not an invented character. The distinction
 * is carried by `AttributeOrigin` on every attribute, and it is the most important thing this
 * module does:
 *
 *  - `OBSERVED`   — read directly from a field. The base size is recorded with it.
 *  - `DERIVED`    — computed from observed values by a stated rule.
 *  - `INFERRED`   — proposed by a model from the observed material. Not measured.
 *  - `USER_ENTERED` — typed by a person.
 *  - `SIMULATED`  — produced during a run. Never evidence of anything.
 *
 * The interface shows the origin on every attribute, and the report refuses to treat an inferred
 * attribute as a finding. A persona whose attributes are all inferred is a character sketch; one
 * built on observed attributes is a description of a segment. Both are useful; conflating them is
 * how a simulation becomes fiction with a confidence interval.
 *
 * Segmentation is deterministic: the same dataset version and the same seed produce the same
 * cohort, because a cohort that changed between runs would make two runs incomparable.
 */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { recordAudit } from '@/lib/audit';
import { emitTelemetry } from '@/telemetry/emit';
import { buildEvidenceContext, EvidenceRefused, type EvidenceContext } from '@/model/context';
import { deriveSeed, seededRandom } from '@/model/provider';
import { readVersionTables } from '@/ingest/structured';
import { isLongSurveyTable } from '@/forecast/series';
import { generateLongTableCohort } from './longCohort';

export type AttributeOrigin = 'OBSERVED' | 'DERIVED' | 'INFERRED' | 'USER_ENTERED' | 'SIMULATED';

export interface GeneratedAttribute {
  group: string;
  key: string;
  label: string;
  value: string;
  origin: AttributeOrigin;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  baseSize: number | null;
  /** Locked attributes are bound to evidence and cannot be edited without breaking that binding. */
  locked: boolean;
}

export interface GeneratedPersona {
  name: string;
  segment: string;
  weight: number;
  baseSize: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  coverageNote: string | null;
  summary: string;
  attributes: GeneratedAttribute[];
}

/**
 * Choose the field to segment on.
 *
 * A categorical field with a handful of well-populated values is what makes segments that mean
 * something. Preference goes to a field that names a market or a tier, because those are the cuts
 * a brief almost always asks about; failing that, the most balanced categorical field.
 */
export function chooseSegmentField(
  context: EvidenceContext,
  /**
   * Name the field to segment on instead of letting the heuristic choose.
   *
   * The heuristic caps candidates at eight distinct values, which is right when it is guessing —
   * a field with forty values produces forty segments too small to say anything about. When a
   * caller names the field, it has already made that judgement, so the cap does not apply and the
   * persona count decides how many segments are taken.
   */
  preferName?: string,
): EvidenceField | null {
  if (preferName) {
    const named = context.fields.find(
      (f) => f.name.toLowerCase() === preferName.toLowerCase() && f.topValues.length >= 2,
    );
    if (named) return named;
  }

  const candidates = context.fields.filter(
    (f) =>
      (f.type === 'CATEGORICAL' || f.type === 'ORDINAL') &&
      f.distinctCount >= 2 &&
      f.distinctCount <= 8 &&
      f.missingPct < 40 &&
      f.topValues.length >= 2,
  );
  if (candidates.length === 0) return null;

  const preferred = /market|country|region|geo|tier|segment|band|income|age/i;
  const named = candidates.filter((f) => preferred.test(f.name));
  const pool = named.length > 0 ? named : candidates;

  // Among equals, prefer the most even split: a field where 95% of respondents fall in one value
  // produces one real segment and a handful of segments too small to say anything about.
  return [...pool].sort((a, b) => evenness(b) - evenness(a))[0] ?? null;
}

type EvidenceField = EvidenceContext['fields'][number];

function evenness(field: EvidenceField): number {
  const counts = field.topValues.map((t) => t.count);
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return 0;
  // Normalised entropy: 1 when every value is equally common, 0 when one value dominates.
  const entropy = -counts
    .map((c) => c / total)
    .filter((p) => p > 0)
    .reduce((s, p) => s + p * Math.log(p), 0);
  return entropy / Math.log(Math.max(counts.length, 2));
}

const SMALL_BASE = 30;

/**
 * Build the cohort.
 *
 * One persona per segment, plus enough repeats to reach the requested count — repeats carry the
 * same observed attributes and differ only in their simulated variation, and the interface says so.
 * Inventing extra *segments* to reach a number would be fabricating evidence; repeating a segment
 * and saying it is a repeat does not.
 */
export function generateCohort(
  context: EvidenceContext,
  options: { personaCount: number; seed: number; segmentFieldName?: string },
): { personas: GeneratedPersona[]; note: string } {
  const segmentField = chooseSegmentField(context, options.segmentFieldName);
  const notes: string[] = [];

  if (!segmentField) {
    notes.push(
      'No field in this dataset splits the sample into usable segments, so the cohort is built ' +
        'from the sample as a whole. Every persona therefore describes the same group.',
    );
  }

  const segments = segmentField
    ? segmentField.topValues.slice(0, Math.max(8, options.personaCount))
    : [{ value: 'All respondents', count: context.rowCount }];

  const totalBase = segments.reduce((s, v) => s + v.count, 0) || 1;
  const personas: GeneratedPersona[] = [];

  // Round-robin over the segments so a requested count larger than the segment count produces an
  // even spread rather than many copies of the first segment.
  for (let i = 0; i < options.personaCount; i += 1) {
    const segment = segments[i % segments.length]!;
    const repeatIndex = Math.floor(i / segments.length);
    const rng = seededRandom(deriveSeed(options.seed, segment.value, String(repeatIndex)));

    const share = segment.count / totalBase;
    const smallBase = segment.count < SMALL_BASE;
    const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = smallBase
      ? 'LOW'
      : segment.count >= 150
        ? 'HIGH'
        : 'MEDIUM';

    const attributes: GeneratedAttribute[] = [];

    if (segmentField) {
      attributes.push({
        group: 'segment',
        key: segmentField.name,
        label: segmentField.name,
        value: segment.value,
        origin: 'OBSERVED',
        confidence,
        baseSize: segment.count,
        locked: true,
      });
    }

    // Every other included measure becomes an attribute at the whole-sample level, marked derived
    // because it describes the sample rather than this segment. Claiming a segment-level figure the
    // cross-tab does not contain would be the cardinal sin here.
    for (const f of context.fields) {
      if (segmentField && f.name === segmentField.name) continue;

      if (f.numeric) {
        attributes.push({
          group: f.type === 'ORDINAL' ? 'attitudes' : 'behaviours',
          key: f.name,
          label: f.name,
          value:
            `sample mean ${f.numeric.mean.toFixed(2)}` +
            (f.scalePoints ? ` of ${f.scalePoints}` : '') +
            `, median ${f.numeric.median.toFixed(2)}`,
          origin: 'DERIVED',
          confidence: f.constructMappingGrade === 'weak' ? 'LOW' : confidence,
          baseSize: f.baseSize,
          locked: true,
        });
      } else if (f.topValues.length > 0) {
        attributes.push({
          group: 'behaviours',
          key: f.name,
          label: f.name,
          value: `most common across the sample: ${f.topValues
            .slice(0, 3)
            .map((t) => t.value)
            .join(', ')}`,
          origin: 'OBSERVED',
          confidence: f.constructMappingGrade === 'weak' ? 'LOW' : confidence,
          baseSize: f.baseSize,
          locked: true,
        });
      }
    }

    // A single simulated attribute, plainly labelled. It gives repeats within a segment something
    // to differ by, and it is the only attribute in the persona that is not grounded in the file.
    attributes.push({
      group: 'motivations',
      key: 'variation',
      label: 'Simulated variation',
      value: `disposition ${(rng() * 2 - 1).toFixed(2)} (−1 sceptical to +1 receptive)`,
      origin: 'SIMULATED',
      confidence: 'LOW',
      baseSize: null,
      locked: false,
    });

    const coverageNote = smallBase
      ? `This segment has ${segment.count} respondents. That is too few to support a claim about ` +
        'it; treat anything this persona says as illustrative of the segment, not as measurement.'
      : repeatIndex > 0
        ? `Repeat ${repeatIndex + 1} of the "${segment.value}" segment. Its observed attributes are ` +
          'identical to the other repeats; only the simulated variation differs.'
        : null;

    personas.push({
      name: segmentField ? `${segment.value}${repeatIndex > 0 ? ` (${repeatIndex + 1})` : ''}` : `Respondent ${i + 1}`,
      segment: segment.value,
      weight: Math.round(share * 1000) / 1000,
      baseSize: segment.count,
      confidence,
      coverageNote,
      summary:
        `Describes the ${segment.value} segment of ${context.datasetName}, ` +
        `${segment.count} of ${totalBase} respondents (${Math.round(share * 100)}%).`,
      attributes,
    });
  }

  if (segments.some((s) => s.count < SMALL_BASE)) {
    notes.push(
      `Some segments have fewer than ${SMALL_BASE} respondents. Those personas are marked low ` +
        'confidence and carry a note saying what they cannot support.',
    );
  }
  if (options.personaCount > segments.length) {
    notes.push(
      `${options.personaCount} personas were requested across ${segments.length} segment(s), so ` +
        'some segments are repeated. Repeats share their observed attributes and are labelled.',
    );
  }

  return { personas, note: notes.join(' ') };
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function createCohort(
  user: SessionUser,
  projectId: string,
  input: {
    datasetVersionId: string;
    personaCount: number;
    seed: number;
    name?: string;
    /** Segment on this field rather than the automatically chosen one. */
    segmentFieldName?: string;
  },
  meta: { ip?: string | null } = {},
): Promise<{ cohortId: string; personaCount: number; note: string }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'persona.create', projectId)) {
    throw new AuthorizationError('persona.create', projectId);
  }

  // The dataset must belong to this project, or a member could build a cohort from someone else's.
  const belongs = await prisma.datasetVersion.findFirst({
    where: { id: input.datasetVersionId, dataset: { projects: { some: { projectId } } } },
    select: { id: true },
  });
  if (!belongs) throw new AuthorizationError('persona.create', projectId);

  // Throws EvidenceRefused when the governance gate is not satisfied. That is the whole point:
  // no cohort can be built from data nobody cleared.
  const context = await buildEvidenceContext(input.datasetVersionId);
  // A survey long table gets real segment personas, unless the review excluded a column they need.
  const needed = ['statement', 'response', 'segment', 'share'];
  const included = new Set(context.fields.map((f) => f.name.trim().toLowerCase()));
  const long = needed.every((c) => included.has(c))
    ? (await readVersionTables(input.datasetVersionId)).find((t) => isLongSurveyTable(t.headers))
    : undefined;
  const fromLong = long ? generateLongTableCohort(long, { datasetName: context.datasetName, seed: input.seed }) : null;
  const { personas, note } = fromLong ?? generateCohort(context, {
    personaCount: input.personaCount,
    seed: input.seed,
    segmentFieldName: input.segmentFieldName,
  });

  const cohort = await persistCohort(user, projectId, {
    name: input.name?.trim() || `Cohort from ${context.datasetName}`,
    note,
    personas,
  });

  await recordGenerationEvents(projectId, cohort.id, context, personas, input.segmentFieldName, fromLong ? 'Segmenting on each market\u2019s published age and gender breaks.' : undefined);

  await recordAudit({
    action: 'persona.cohort.generated',
    targetType: 'cohort',
    targetId: cohort.id,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: {
      datasetVersionId: input.datasetVersionId,
      evidenceManifestHash: context.manifestHash,
      personaCount: personas.length,
      seed: input.seed,
    },
    ip: meta.ip ?? null,
  });

  return { cohortId: cohort.id, personaCount: personas.length, note };
}

/** Write a generated cohort and its candidate personas in one transaction. */
export async function persistCohort(
  user: SessionUser,
  projectId: string,
  input: { name: string; note: string; personas: GeneratedPersona[]; populationSampleId?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.cohort.create({
      data: {
        projectId,
        name: input.name,
        mode: 'CLUSTER',
        generationNote: input.note || null,
        populationSampleId: input.populationSampleId ?? null,
      },
    });
    for (const p of input.personas) {
      const persona = await tx.persona.create({ data: { cohortId: c.id, type: 'CONSUMER', name: p.name } });
      const version = await tx.personaVersion.create({
        data: {
          personaId: persona.id,
          versionNo: 1,
          approval: 'CANDIDATE',
          mode: 'CLUSTER',
          summary: p.summary,
          segment: p.segment,
          weight: p.weight,
          baseSize: p.baseSize,
          confidence: p.confidence,
          coverageNote: p.coverageNote,
          createdById: user.userId,
        },
      });
      await tx.personaAttribute.createMany({ data: p.attributes.map((a) => ({ ...a, personaVersionId: version.id })) });
    }
    return c;
  });
}

/**
 * The generation record, in the order the work was done. Generation is deterministic and runs in
 * one pass, so these are written once it has finished and been persisted — each states a result
 * that is now true of the stored cohort, never a step that is merely expected to happen.
 */
async function recordGenerationEvents(
  projectId: string,
  cohortId: string,
  context: EvidenceContext,
  personas: GeneratedPersona[],
  requestedSegmentField: string | undefined,
  segmentationNote?: string,
): Promise<void> {
  const base = { sourceType: 'cohort' as const, sourceId: cohortId, projectId, cohortId };
  await emitTelemetry({
    ...base,
    eventType: 'evidence.loaded',
    stage: 'evidence',
    status: 'completed',
    message: `Evidence loaded from ${context.datasetName}: ${context.fields.length} permitted field(s), ${context.rowCount.toLocaleString()} rows. Excluded fields contribute nothing.`,
    safeMetadata: { fieldCount: context.fields.length, rowCount: context.rowCount },
  });

  const segmentField = segmentationNote ? null : chooseSegmentField(context, requestedSegmentField);
  await emitTelemetry({
    ...base,
    eventType: 'segment.validated',
    stage: 'segmentation',
    status: segmentField || segmentationNote ? 'completed' : 'warning',
    message: segmentationNote ?? (segmentField
      ? `Segmenting on "${segmentField.name}" (${Math.min(segmentField.topValues.length, Math.max(8, personas.length))} segment value(s)).`
      : 'No field splits the sample into usable segments; every persona describes the whole sample.'),
    safeMetadata: segmentField ? { fieldName: segmentField.name } : null,
  });

  let lowConfidence = 0;
  let index = 0;
  for (const p of personas) {
    index += 1;
    const grounded = p.attributes.filter((a) => a.origin === 'OBSERVED' || a.origin === 'DERIVED').length;
    await emitTelemetry({
      ...base,
      eventType: 'persona.generated',
      stage: 'generation',
      status: 'active',
      message: `Candidate "${p.name}" generated: ${grounded} of ${p.attributes.length} attributes grounded in the data.`,
      progressCurrent: index,
      progressTotal: personas.length,
      safeMetadata: { personaKey: p.name, segment: p.segment, confidence: p.confidence },
    });
    if (p.confidence === 'LOW') {
      lowConfidence += 1;
      await emitTelemetry({
        ...base,
        eventType: 'persona.requires_review',
        stage: 'grounding',
        status: 'warning',
        severity: 'warning',
        message: `"${p.name}": confidence set to low — base of ${p.baseSize ?? 0} is below ${SMALL_BASE}. Requires review.`,
        safeMetadata: { personaKey: p.name },
      });
    }
  }
  await emitTelemetry({
    ...base,
    eventType: 'cohort.stage',
    stage: 'generation',
    status: 'completed',
    message: `${personas.length} candidate(s) generated.`,
    progressCurrent: personas.length,
    progressTotal: personas.length,
  });
  await emitTelemetry({
    ...base,
    eventType: 'grounding.checked',
    stage: 'grounding',
    status: lowConfidence > 0 ? 'warning' : 'completed',
    message:
      `Evidence grounding checked: every attribute carries its origin; one simulated attribute per persona. ` +
      (lowConfidence > 0 ? `${lowConfidence} persona(s) rest on a small base.` : 'No persona rests on a small base.') +
      ' No contradictions were detected (the generator does not produce conflicting attributes).',
    progressCurrent: personas.length - lowConfidence,
    progressTotal: personas.length,
  });

  const segments = new Set(personas.map((p) => p.segment)).size;
  await emitTelemetry({
    ...base,
    eventType: 'cohort.normalized',
    stage: 'normalization',
    status: 'completed',
    message: `Cohort normalised: ${personas.length} persona(s) across ${segments} segment(s); weights are segment shares of the sample${personas.length > segments ? '; repeats labelled' : ''}.`,
    safeMetadata: { personaCount: personas.length, count: segments },
  });
  await emitTelemetry({
    ...base,
    eventType: 'cohort.ready',
    stage: 'approval',
    status: 'pending',
    message: 'Cohort ready. Waiting for a person with approval rights to approve it.',
  });
}

export async function listCohorts(user: SessionUser, projectId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);

  return prisma.cohort.findMany({
    where: { projectId },
    orderBy: { generatedAt: 'desc' },
    include: {
      personas: {
        include: {
          versions: {
            orderBy: { versionNo: 'desc' },
            take: 1,
            include: { attributes: { orderBy: { group: 'asc' } } },
          },
        },
      },
    },
  });
}

export class ApprovalRefused extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'ApprovalRefused';
  }
}

/**
 * Approve a cohort for use in a run.
 *
 * Approval is what makes a persona version immutable: once approved, editing it would change what a
 * completed run says it simulated. Changes create a new version instead.
 */
export async function approveCohort(
  user: SessionUser,
  projectId: string,
  cohortId: string,
  meta: { ip?: string | null } = {},
): Promise<{ approved: number }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'persona.approve', projectId)) {
    throw new AuthorizationError('persona.approve', projectId);
  }

  const cohort = await prisma.cohort.findFirst({
    where: { id: cohortId, projectId },
    include: { personas: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
  });
  if (!cohort) throw new AuthorizationError('persona.approve', projectId);

  const versionIds = cohort.personas
    .map((p) => p.versions[0]?.id)
    .filter((id): id is string => Boolean(id));
  if (versionIds.length === 0) {
    throw new ApprovalRefused(['This cohort has no personas to approve.']);
  }

  const result = await prisma.personaVersion.updateMany({
    where: { id: { in: versionIds } },
    data: { approval: 'APPROVED' },
  });

  await emitTelemetry({
    eventType: 'cohort.approved',
    sourceType: 'cohort',
    sourceId: cohortId,
    projectId,
    cohortId,
    stage: 'approval',
    status: 'completed',
    message: `${result.count} persona(s) approved by ${user.email}. The cohort can now be used in a run.`,
    progressCurrent: result.count,
    safeMetadata: { personaCount: result.count },
  });

  await recordAudit({
    action: 'persona.cohort.approved',
    targetType: 'cohort',
    targetId: cohortId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: { personaVersions: result.count },
    reason: `Cohort approved by ${user.email}`,
    ip: meta.ip ?? null,
  });

  return { approved: result.count };
}

export { EvidenceRefused };
