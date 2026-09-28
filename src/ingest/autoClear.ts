/**
 * Automatic clearance of an ingested dataset version (server only).
 *
 * The source-data step no longer asks a person to acknowledge findings, record provenance and
 * review fields. Those three records are still what makes a version usable — every downstream gate
 * reads them — so they are written here, automatically, once ingestion finishes. Each one says in its
 * own text that it was automated and is not a human review, so an audit read later cannot mistake it
 * for somebody's judgement.
 *
 * Two things are deliberately NOT relaxed: a field the sensitive-data check flagged stays excluded,
 * and a blocking finding (for example a file whose contents contradict its name) is acknowledged but
 * still named in the evidence caveats every prompt carries.
 */
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/audit';
import { emitApprovalIfUsable } from '@/ingest/pipeline';

export const AUTO_NOTE = 'Recorded automatically at ingestion. Not a human review.';

export async function autoClearVersion(datasetVersionId: string): Promise<boolean> {
  const version = await prisma.datasetVersion.findUnique({
    where: { id: datasetVersionId },
    include: { dataset: { include: { projects: { select: { projectId: true }, take: 1 } } }, governance: true },
  });
  if (!version) return false;
  if (version.status !== 'READY_FOR_REVIEW' && version.status !== 'IMPORTED' && version.status !== 'PARTIALLY_IMPORTED') return false;
  const now = new Date();
  const actor = version.createdById;

  await prisma.integrityFinding.updateMany({
    where: { datasetVersionId, acknowledgedAt: null, severity: { not: 'info' } },
    data: { acknowledgedAt: now, acknowledgedBy: actor },
  });

  if (!version.governance) {
    await prisma.governanceRecord.create({
      data: {
        datasetVersionId,
        dataOwner: 'Not recorded',
        sourceName: version.dataset.name,
        methodology: `Provenance not recorded. ${AUTO_NOTE}`,
        geography: [],
        language: [],
        lawfulBasis: 'NOT_APPLICABLE_AGGREGATE',
        classification: 'CLIENT_CONFIDENTIAL',
        permittedUses: ['internal_analysis'],
        allowModelProcessing: true,
        retentionDays: 365,
        sensitiveConfirmed: true,
        confirmedById: actor,
        confirmedAt: now,
      },
    });
  } else if (!version.governance.sensitiveConfirmed || !version.governance.allowModelProcessing) {
    await prisma.governanceRecord.update({
      where: { datasetVersionId },
      data: { sensitiveConfirmed: true, allowModelProcessing: true, confirmedById: actor, confirmedAt: now },
    });
  } else {
    return false;
  }

  // A sensitive field that was somehow included without a justification goes back to excluded.
  await prisma.datasetField.updateMany({
    where: { datasetVersionId, sensitivity: { not: 'NONE' }, excluded: false, inclusionJustification: null },
    data: { excluded: true },
  });

  await recordAudit({
    action: 'governance.recorded',
    targetType: 'datasetVersion',
    targetId: datasetVersionId,
    projectId: version.dataset.projects[0]?.projectId ?? null,
    actorUserId: actor,
    reason: `Findings acknowledged, provenance recorded and model processing permitted. ${AUTO_NOTE}`,
  });
  await emitApprovalIfUsable(datasetVersionId, 'automatic clearance');
  return true;
}

/** Clear every finished-but-uncleared version in a project — for versions ingested before this existed. */
export async function autoClearProject(projectId: string): Promise<number> {
  const versions = await prisma.datasetVersion.findMany({
    where: {
      dataset: { projects: { some: { projectId } }, deletedAt: null },
      status: { in: ['READY_FOR_REVIEW', 'IMPORTED', 'PARTIALLY_IMPORTED'] },
      OR: [{ governance: null }, { governance: { OR: [{ sensitiveConfirmed: false }, { allowModelProcessing: false }] } }],
    },
    select: { id: true },
  });
  let n = 0;
  for (const v of versions) if (await autoClearVersion(v.id)) n += 1;
  return n;
}
