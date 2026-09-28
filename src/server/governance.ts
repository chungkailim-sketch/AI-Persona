/**
 * The governance gate (GOV-01..GOV-06).
 *
 * This is the narrowest and most consequential surface in the application. Everything upstream
 * prepares evidence; this is where a named person takes responsibility for it, and where
 * `allowModelProcessing` — the single flag that decides whether any of this data may ever be placed
 * in a model prompt — is set.
 *
 * Three properties are enforced rather than encouraged:
 *
 *  1. The flag defaults to false and can only become true through this function, by someone holding
 *     `dataset.upload` on the project, with their identity recorded.
 *  2. Confirming field sensitivity is a separate act from recording provenance, because they are
 *     separate judgements and bundling them invites one click to stand for both.
 *  3. Including a field the detector flagged requires a written justification. A checkbox would
 *     record that someone clicked; a sentence records what they thought.
 */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { recordAudit } from '@/lib/audit';
import { emitApprovalIfUsable } from '@/ingest/pipeline';

export type LawfulBasis =
  | 'CONSENT'
  | 'CONTRACT'
  | 'LEGITIMATE_INTEREST'
  | 'PUBLIC_TASK'
  | 'LEGAL_OBLIGATION'
  | 'NOT_APPLICABLE_AGGREGATE';

export type DataClassification = 'PUBLIC' | 'INTERNAL' | 'CLIENT_CONFIDENTIAL' | 'RESTRICTED';

export interface GovernanceInput {
  dataOwner: string;
  sourceName: string;
  methodology: string;
  collectionStart?: Date | null;
  collectionEnd?: Date | null;
  geography: string[];
  language: string[];
  sampleSize?: number | null;
  lawfulBasis: LawfulBasis;
  classification: DataClassification;
  permittedUses: string[];
  restrictions?: string | null;
  retentionDays: number;
  /** The flag. False unless the person setting it means it. */
  allowModelProcessing: boolean;
}

/** Ownership of a dataset version by a project, checked before any governance action. */
async function versionInProject(datasetVersionId: string, projectId: string): Promise<boolean> {
  const found = await prisma.datasetVersion.findFirst({
    where: { id: datasetVersionId, dataset: { projects: { some: { projectId } } } },
    select: { id: true },
  });
  return Boolean(found);
}

export async function recordGovernance(
  user: SessionUser,
  projectId: string,
  datasetVersionId: string,
  input: GovernanceInput,
  meta: { ip?: string | null } = {},
): Promise<void> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'dataset.upload', projectId)) {
    throw new AuthorizationError('dataset.upload', projectId);
  }
  if (!(await versionInProject(datasetVersionId, projectId))) {
    throw new AuthorizationError('dataset.upload', projectId);
  }

  const before = await prisma.governanceRecord.findUnique({ where: { datasetVersionId } });

  const expiresAt =
    input.retentionDays > 0
      ? new Date(Date.now() + input.retentionDays * 24 * 60 * 60 * 1000)
      : null;

  const data = {
    dataOwner: input.dataOwner.trim(),
    sourceName: input.sourceName.trim(),
    methodology: input.methodology.trim(),
    collectionStart: input.collectionStart ?? null,
    collectionEnd: input.collectionEnd ?? null,
    geography: input.geography,
    language: input.language,
    sampleSize: input.sampleSize ?? null,
    lawfulBasis: input.lawfulBasis,
    classification: input.classification,
    permittedUses: input.permittedUses,
    restrictions: input.restrictions?.trim() || null,
    retentionDays: input.retentionDays,
    expiresAt,
    allowModelProcessing: input.allowModelProcessing,
  };

  await prisma.governanceRecord.upsert({
    where: { datasetVersionId },
    update: data,
    create: { datasetVersionId, ...data },
  });

  await recordAudit({
    action:
      before?.allowModelProcessing !== data.allowModelProcessing
        ? data.allowModelProcessing
          ? 'governance.model_processing.granted'
          : 'governance.model_processing.withdrawn'
        : 'governance.recorded',
    targetType: 'governanceRecord',
    targetId: datasetVersionId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    beforeValue: before
      ? {
          lawfulBasis: before.lawfulBasis,
          classification: before.classification,
          allowModelProcessing: before.allowModelProcessing,
        }
      : undefined,
    afterValue: {
      lawfulBasis: data.lawfulBasis,
      classification: data.classification,
      allowModelProcessing: data.allowModelProcessing,
    },
    reason:
      before?.allowModelProcessing !== data.allowModelProcessing
        ? `Model processing ${data.allowModelProcessing ? 'permitted' : 'withdrawn'} by ${user.email}`
        : 'Governance record updated',
    ip: meta.ip ?? null,
  });
  await emitApprovalIfUsable(datasetVersionId, user.email);
}

export interface FieldDecision {
  fieldId: string;
  excluded: boolean;
  /** Required when a flagged field is being included. */
  inclusionJustification?: string | null;
  redacted?: boolean;
  constructMappingGrade?: 'direct' | 'partial' | 'weak' | null;
}

export class GovernanceRefused extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'GovernanceRefused';
  }
}

/**
 * Apply field-level decisions and confirm the sensitivity review.
 *
 * Refuses the whole submission if any flagged field is being included without a justification,
 * rather than saving the rest and leaving a half-applied review that nobody notices.
 */
export async function confirmFieldReview(
  user: SessionUser,
  projectId: string,
  datasetVersionId: string,
  decisions: FieldDecision[],
  meta: { ip?: string | null } = {},
): Promise<void> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'dataset.upload', projectId)) {
    throw new AuthorizationError('dataset.upload', projectId);
  }
  if (!(await versionInProject(datasetVersionId, projectId))) {
    throw new AuthorizationError('dataset.upload', projectId);
  }

  const fields = await prisma.datasetField.findMany({
    where: { datasetVersionId },
    select: { id: true, name: true, sensitivity: true },
  });
  const byId = new Map(fields.map((f) => [f.id, f]));

  const problems: string[] = [];
  for (const d of decisions) {
    const field = byId.get(d.fieldId);
    if (!field) {
      problems.push('A decision referred to a field that is not part of this dataset version.');
      continue;
    }
    if (field.sensitivity !== 'NONE' && !d.excluded) {
      const justification = d.inclusionJustification?.trim() ?? '';
      if (justification.length < 20) {
        problems.push(
          `"${field.name}" was detected as ${field.sensitivity === 'PII' ? 'personal' : 'special-category'} ` +
            'data. Including it needs a written reason of at least 20 characters saying why it is ' +
            'necessary and what limits apply.',
        );
      }
    }
  }
  // The confirmation is stored on the governance record. Without one, the update below touched no
  // row and the page reported success anyway — found in an end-to-end run, where the field review
  // sits above the provenance form. Refuse instead of pretending.
  const governance = await prisma.governanceRecord.findUnique({ where: { datasetVersionId }, select: { id: true } });
  if (!governance) {
    problems.push('Record provenance and permission first. The field review confirmation is stored with that record, so it cannot be saved before it exists.');
  }
  if (problems.length > 0) throw new GovernanceRefused(problems);

  await prisma.$transaction([
    ...decisions.map((d) =>
      prisma.datasetField.update({
        where: { id: d.fieldId },
        data: {
          excluded: d.excluded,
          redacted: d.redacted ?? false,
          inclusionJustification: d.excluded ? null : (d.inclusionJustification?.trim() || null),
          constructMappingGrade: d.constructMappingGrade ?? null,
        },
      }),
    ),
    prisma.governanceRecord.updateMany({
      where: { datasetVersionId },
      data: { sensitiveConfirmed: true, confirmedById: user.userId, confirmedAt: new Date() },
    }),
  ]);

  const included = decisions.filter((d) => !d.excluded).length;
  const includedSensitive = decisions.filter(
    (d) => !d.excluded && byId.get(d.fieldId)?.sensitivity !== 'NONE',
  );

  await recordAudit({
    action: 'dataset.field.review.confirmed',
    targetType: 'datasetFieldReview',
    targetId: datasetVersionId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: {
      fieldsReviewed: decisions.length,
      included,
      sensitiveIncluded: includedSensitive.map((d) => ({
        field: byId.get(d.fieldId)?.name,
        justification: d.inclusionJustification,
      })),
    },
    reason: `Field sensitivity review confirmed by ${user.email}`,
    ip: meta.ip ?? null,
  });
  await emitApprovalIfUsable(datasetVersionId, user.email);
}

export async function acknowledgeFinding(
  user: SessionUser,
  projectId: string,
  findingId: string,
  note: string,
  meta: { ip?: string | null } = {},
): Promise<void> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'dataset.upload', projectId)) {
    throw new AuthorizationError('dataset.upload', projectId);
  }

  const finding = await prisma.integrityFinding.findFirst({
    where: { id: findingId, datasetVersion: { dataset: { projects: { some: { projectId } } } } },
  });
  if (!finding) throw new AuthorizationError('dataset.upload', projectId);

  if (note.trim().length < 10) {
    throw new GovernanceRefused([
      'Acknowledging a finding requires a note saying how it was resolved or why it is acceptable.',
    ]);
  }

  await prisma.integrityFinding.update({
    where: { id: findingId },
    data: { acknowledgedAt: new Date(), acknowledgedBy: user.userId },
  });

  await recordAudit({
    action: 'dataset.finding.acknowledged',
    targetType: 'integrityFinding',
    targetId: findingId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: { check: finding.check, severity: finding.severity, note: note.trim() },
    reason: `Integrity finding acknowledged by ${user.email}`,
    ip: meta.ip ?? null,
  });
  await emitApprovalIfUsable(finding.datasetVersionId, user.email);
}

/** Shown above the governance form. It states what the flag actually does. */
export const MODEL_PROCESSING_NOTICE =
  'Permitting model processing means values from the included fields may be sent to the AI ' +
  'provider as part of a prompt. Excluded fields are never sent. This is the only setting that ' +
  'allows it, it is off until you turn it on, and turning it on is recorded against your name.';
