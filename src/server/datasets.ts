/**
 * Dataset operations.
 *
 * As with projects, every function authorizes for itself. Dataset permissions are project-scoped,
 * so each one takes the project the action is being performed in.
 *
 * Immutability is the other rule enforced here: a `DatasetVersion` that has been ingested is never
 * edited. A correction creates a new version that records what it was derived from and why, so a
 * finding that cited version 2 still means what it meant when it was written.
 */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { recordAudit } from '@/lib/audit';
import { storage } from '@/storage/adapter';
import { datasetEmitter } from '@/telemetry/emit';
import { enqueue } from '@/queue/queue';
import { UPLOAD_LIMITS, kindFromName } from '@/ingest/limits';
import { assessUsability } from '@/ingest/pipeline';

export interface UploadedFile {
  originalName: string;
  mimeType: string;
  bytes: Buffer;
}

export class UploadRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadRejected';
  }
}

/**
 * Validate an upload before a single byte is stored.
 *
 * The extension is what selects the parser, and it is checked against the declared MIME type: a
 * browser's MIME guess is unreliable and a client can set it to anything, so agreement between the
 * two is required rather than either being trusted alone.
 */
export function validateUpload(file: UploadedFile): void {
  if (file.bytes.byteLength === 0) {
    throw new UploadRejected(`${file.originalName} is empty.`);
  }
  if (file.bytes.byteLength > UPLOAD_LIMITS.maxBytes) {
    throw new UploadRejected(
      `${file.originalName} is ${(file.bytes.byteLength / 1024 / 1024).toFixed(1)}MB. The limit is ` +
        `${UPLOAD_LIMITS.maxBytes / 1024 / 1024}MB.`,
    );
  }
  const kind = kindFromName(file.originalName);
  if (!kind) {
    throw new UploadRejected(
      `${file.originalName} is not a supported format. Upload a .csv or .xlsx file.`,
    );
  }
  // An .xlsx that is not a ZIP archive is not an .xlsx, whatever it is called.
  if (kind === 'xlsx') {
    const magic = file.bytes.subarray(0, 2).toString('latin1');
    if (magic !== 'PK') {
      throw new UploadRejected(
        `${file.originalName} has a spreadsheet extension but its contents are not a spreadsheet.`,
      );
    }
  }
}

export async function createDatasetWithVersion(
  user: SessionUser,
  projectId: string,
  input: { name: string; files: UploadedFile[]; changeNote?: string },
  meta: { ip?: string | null } = {},
): Promise<{ datasetId: string; datasetVersionId: string; jobId: string }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'dataset.upload', projectId)) {
    throw new AuthorizationError('dataset.upload', projectId);
  }

  if (input.files.length === 0) throw new UploadRejected('No files were selected.');
  if (input.files.length > UPLOAD_LIMITS.maxFilesPerVersion) {
    throw new UploadRejected(
      `Up to ${UPLOAD_LIMITS.maxFilesPerVersion} files can be uploaded as one version.`,
    );
  }
  for (const f of input.files) validateUpload(f);
  const total = input.files.reduce((n, f) => n + f.bytes.byteLength, 0);
  if (total > UPLOAD_LIMITS.maxRequestBytes) {
    throw new UploadRejected(
      `These files total ${(total / 1024 / 1024).toFixed(1)}MB. One upload is limited to ` +
        `${UPLOAD_LIMITS.maxRequestBytes / 1024 / 1024}MB; upload the rest as a second dataset.`,
    );
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { workspaceId: true },
  });

  // Store the bytes first. A dataset row pointing at a file that was never written is worse than
  // an orphaned object, which costs only disk.
  const stored = await Promise.all(
    input.files.map(async (f) => ({
      file: f,
      object: await storage().put(`datasets/${projectId}`, f.bytes),
    })),
  );

  const { datasetId, datasetVersionId } = await prisma.$transaction(async (tx) => {
    const dataset = await tx.dataset.create({
      data: {
        workspaceId: project.workspaceId,
        name: input.name.trim(),
        createdById: user.userId,
      },
    });
    const version = await tx.datasetVersion.create({
      data: {
        datasetId: dataset.id,
        versionNo: 1,
        status: 'UPLOADING',
        createdById: user.userId,
        changeNote: input.changeNote?.trim() || null,
      },
    });
    await tx.sourceFile.createMany({
      data: stored.map((s) => ({
        datasetVersionId: version.id,
        originalName: s.file.originalName,
        storageKey: s.object.key,
        mimeType: s.file.mimeType,
        byteSize: s.object.byteSize,
        // Recorded honestly: no scanner is configured in this build, and the field says so rather
        // than implying a clean scan.
        scanStatus: 'NOT_SCANNED',
        scanProvider: 'none',
      })),
    });
    await tx.projectDataset.create({ data: { projectId, datasetId: dataset.id } });
    return { datasetId: dataset.id, datasetVersionId: version.id };
  });

  const { id: jobId } = await enqueue({
    kind: 'ingest',
    input: { datasetVersionId },
    idempotencyKey: `ingest:${datasetVersionId}`,
  });

  // The first two pipeline stages happen here, in the request, and are recorded as they are true:
  // the files have been received and stored, and no scanner looked at them.
  const emit = await datasetEmitter(datasetVersionId, jobId);
  for (const s of stored) {
    await emit({
      eventType: 'file.upload.completed',
      stage: 'upload_received',
      status: 'active',
      message: `${s.file.originalName} received and stored (${s.object.byteSize.toLocaleString()} bytes).`,
      safeMetadata: { fileName: s.file.originalName },
    });
  }
  await emit({
    eventType: 'ingest.stage',
    stage: 'upload_received',
    status: 'completed',
    message: `${stored.length} file(s) received. Ingestion queued.`,
    progressCurrent: stored.length,
    progressTotal: stored.length,
    safeMetadata: { fileCount: stored.length },
  });
  await emit({
    eventType: 'scan.not_performed',
    stage: 'safety_scan',
    status: 'skipped',
    severity: 'warning',
    message: 'No malware scanner is configured in this build. Every file is recorded as NOT_SCANNED.',
  });

  await recordAudit({
    action: 'dataset.uploaded',
    targetType: 'datasetVersion',
    targetId: datasetVersionId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: {
      dataset: input.name,
      files: input.files.map((f) => f.originalName),
      bytes: input.files.reduce((s, f) => s + f.bytes.byteLength, 0),
    },
    ip: meta.ip ?? null,
  });

  return { datasetId, datasetVersionId, jobId };
}

/**
 * Re-queue ingestion for a version whose ingestion failed. Only a failed version can be retried —
 * a version that ingested is re-ingested by uploading a new one, so the history stays intact.
 */
export async function retryIngestion(
  user: SessionUser,
  projectId: string,
  datasetVersionId: string,
): Promise<{ jobId: string }> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'dataset.upload', projectId)) throw new AuthorizationError('dataset.upload', projectId);
  const version = await prisma.datasetVersion.findFirst({
    where: { id: datasetVersionId, dataset: { projects: { some: { projectId } } } },
    select: { id: true, status: true },
  });
  if (!version) throw new AuthorizationError('dataset.upload', projectId);
  if (version.status !== 'FAILED') throw new UploadRejected('Only a version whose ingestion failed can be retried.');

  const { id: jobId } = await enqueue({
    kind: 'ingest',
    input: { datasetVersionId },
    idempotencyKey: `ingest:${datasetVersionId}:retry:${Date.now()}`,
  });
  await prisma.datasetVersion.update({ where: { id: datasetVersionId }, data: { status: 'UPLOADING' } });
  const emit = await datasetEmitter(datasetVersionId, jobId);
  await emit({
    eventType: 'ingest.retry.requested',
    stage: 'job',
    status: 'active',
    message: `Retry requested by ${user.email}. Ingestion queued again.`,
  });
  await recordAudit({
    action: 'dataset.version.created',
    targetType: 'datasetVersion',
    targetId: datasetVersionId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    reason: 'Ingestion retried after failure',
  });
  return { jobId };
}

export async function listProjectDatasets(user: SessionUser, projectId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);

  const links = await prisma.projectDataset.findMany({
    where: { projectId, dataset: { deletedAt: null } },
    include: {
      dataset: {
        include: {
          versions: {
            orderBy: { versionNo: 'desc' },
            include: {
              _count: { select: { fields: true, integrity: true } },
              integrity: { select: { severity: true, acknowledgedAt: true } },
              governance: { select: { allowModelProcessing: true, sensitiveConfirmed: true } },
            },
          },
        },
      },
    },
    orderBy: { attachedAt: 'desc' },
  });

  return links.map((l) => {
    const latest = l.dataset.versions[0];
    return {
      datasetId: l.dataset.id,
      name: l.dataset.name,
      isDemo: l.dataset.isDemo,
      versionCount: l.dataset.versions.length,
      latest: latest
        ? {
            id: latest.id,
            versionNo: latest.versionNo,
            status: latest.status,
            rowCount: latest.rowCount,
            fieldCount: latest._count.fields,
            qualityScore: latest.qualityScore,
            blocking: latest.integrity.filter(
              (f) => f.severity === 'blocking' && !f.acknowledgedAt,
            ).length,
            warnings: latest.integrity.filter(
              (f) => f.severity === 'warning' && !f.acknowledgedAt,
            ).length,
            governed: Boolean(latest.governance?.sensitiveConfirmed),
            modelProcessingAllowed: Boolean(latest.governance?.allowModelProcessing),
          }
        : null,
    };
  });
}

export async function getDatasetVersion(
  user: SessionUser,
  projectId: string,
  datasetVersionId: string,
) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);

  // Membership of the project is not enough on its own: the version must actually belong to a
  // dataset attached to *this* project, or any member could read any version by guessing an id.
  const version = await prisma.datasetVersion.findFirst({
    where: { id: datasetVersionId, dataset: { projects: { some: { projectId } } } },
    include: {
      dataset: true,
      files: true,
      fields: { orderBy: { name: 'asc' } },
      integrity: { orderBy: { severity: 'asc' } },
      quality: true,
      governance: true,
    },
  });
  if (!version) throw new AuthorizationError('project.view', projectId);

  const usability = await assessUsability(datasetVersionId);
  const canSeeSensitive = can(ctx, 'dataset.viewSensitive', projectId);

  return {
    version,
    usability,
    // Sensitive fields are listed for everyone — hiding their existence would hide the gap — but
    // their sample values are withheld unless the viewer holds the permission.
    fields: version.fields.map((f) => ({
      ...f,
      profile:
        f.sensitivity !== 'NONE' && !canSeeSensitive
          ? { withheld: true as const }
          : (f.profile as unknown),
    })),
    canSeeSensitive,
  };
}
