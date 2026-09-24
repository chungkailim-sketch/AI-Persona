/**
 * The ingestion pipeline.
 *
 * A dataset version moves through explicit states and stops at `READY_FOR_REVIEW`. It does not
 * become usable on its own: a person must classify the fields, record the provenance and say
 * whether the data may be processed by a model. That gate is the point of the whole pipeline — the
 * automation prepares the evidence and the judgement stays with a named human (DATA-11, GOV-04).
 *
 * Every stage writes its result to the database as it completes, so a failure at stage five leaves
 * the first four visible rather than discarding the work and reporting "failed".
 */
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { storage } from '@/storage/adapter';
import { parseFile } from '@/ingest/parse';
import { profileTable, type FieldProfile } from '@/ingest/profile';
import { classifyField } from '@/ingest/sensitivity';
import { secondOpinionOnFields } from '@/judge/checks';
import { checkIntegrity } from '@/ingest/integrity';
import { scoreQuality } from '@/ingest/quality';
import { kindFromName } from '@/ingest/limits';
import { datasetEmitter } from '@/telemetry/emit';
import type { IngestStageKey } from '@/telemetry/contract';

export interface IngestOutcome {
  datasetVersionId: string;
  status: 'READY_FOR_REVIEW' | 'FAILED' | 'PARTIALLY_IMPORTED';
  rowCount: number;
  fieldCount: number;
  blockingFindings: number;
  warningFindings: number;
  qualityScore: number;
  notes: string[];
}

export async function runIngest(
  datasetVersionId: string,
  opts: { correlationId?: string | null } = {},
): Promise<IngestOutcome> {
  const emit = await datasetEmitter(datasetVersionId, opts.correlationId);
  // The stage currently in hand, so a throw anywhere below is attributed to the stage it happened
  // in rather than to "ingestion" in general.
  let stageNow: IngestStageKey = 'file_identification';
  try {
    return await ingestStages(datasetVersionId, emit, (s) => {
      stageNow = s;
    });
  } catch (e) {
    await emit({
      eventType: 'ingest.stage.failed',
      stage: stageNow,
      status: 'failed',
      // Whether it is retried is the queue's decision; the worker records one if it is scheduled.
      retryable: false,
      severity: 'error',
      message: 'This stage stopped with an error. The cause is in the server log under the correlation id.',
    });
    // Carry the stage out to the worker, which knows whether a retry is scheduled.
    if (e && typeof e === 'object') Object.assign(e, { ingestStage: stageNow });
    throw e;
  }
}

type Emit = Awaited<ReturnType<typeof datasetEmitter>>;

async function ingestStages(
  datasetVersionId: string,
  emit: Emit,
  enter: (stage: IngestStageKey) => void,
): Promise<IngestOutcome> {
  const notes: string[] = [];

  const version = await prisma.datasetVersion.findUnique({
    where: { id: datasetVersionId },
    include: { files: true },
  });
  if (!version) throw new Error(`Dataset version ${datasetVersionId} does not exist.`);
  if (version.files.length === 0) {
    await prisma.datasetVersion.update({
      where: { id: datasetVersionId },
      data: { status: 'FAILED', parseReport: { error: 'No files were attached.' } },
    });
    throw new Error('No files were attached to this version.');
  }

  // ── File identification. The format is decided from the name before any byte is parsed. ──
  enter('file_identification');
  for (const file of version.files) {
    const kind = kindFromName(file.originalName);
    await emit({
      eventType: 'file.identified',
      stage: 'file_identification',
      status: kind ? 'active' : 'warning',
      message: kind
        ? `${file.originalName} identified as ${kind.toUpperCase()}.`
        : `${file.originalName} has no recognised extension; it will be read as CSV.`,
      safeMetadata: { fileName: file.originalName },
    });
  }
  await emit({
    eventType: 'ingest.stage',
    stage: 'file_identification',
    status: 'completed',
    message: `${version.files.length} file(s) identified.`,
    progressCurrent: version.files.length,
    progressTotal: version.files.length,
    safeMetadata: { fileCount: version.files.length },
  });

  await prisma.datasetVersion.update({
    where: { id: datasetVersionId },
    data: { status: 'PARSING' },
  });
  enter('parsing');
  await emit({
    eventType: 'ingest.stage',
    stage: 'parsing',
    status: 'active',
    message: `Reading ${version.files.length} file(s).`,
    progressCurrent: 0,
    progressTotal: version.files.length,
  });

  const allProfiles: { profile: FieldProfile; values: string[] }[] = [];
  const findings: { check: string; severity: string; message: string; detail?: unknown }[] = [];
  const chunkRows: {
    locatorType: string;
    locator: string;
    fieldName: string;
    value: string | null;
    numericValue: number | null;
    baseSize: number | null;
    suppressed: boolean;
  }[] = [];

  let totalRows = 0;
  let totalCells = 0;
  const hasher = createHash('sha256');
  let anyParsed = false;
  let failedFiles = 0;
  let filesDone = 0;

  for (const file of version.files) {
    const kind = kindFromName(file.originalName) ?? 'csv';
    let bytes: Buffer;
    try {
      bytes = await storage().get(file.storageKey);
    } catch {
      await prisma.sourceFile.update({
        where: { id: file.id },
        data: { extractionStatus: 'FAILED', parseError: 'The stored file could not be read.' },
      });
      notes.push(`${file.originalName}: the stored file could not be read.`);
      failedFiles += 1;
      filesDone += 1;
      await emit({
        eventType: 'file.read.failed',
        stage: 'parsing',
        status: 'warning',
        severity: 'warning',
        message: `${file.originalName}: the stored file could not be read.`,
        progressCurrent: filesDone,
        progressTotal: version.files.length,
        safeMetadata: { fileName: file.originalName },
      });
      continue;
    }
    hasher.update(bytes);

    try {
      const parsed = await parseFile(bytes, kind);
      notes.push(...parsed.notes.map((n) => `${file.originalName}: ${n}`));

      let fileRows = 0;
      for (const table of parsed.tables) {
        anyParsed = true;
        totalRows += table.rows.length;
        fileRows += table.rows.length;
        totalCells += table.rows.length * table.headers.length;

        if (table.sheetName) {
          await emit({
            eventType: 'sheet.detected',
            stage: 'parsing',
            status: 'active',
            message: `Sheet "${table.sheetName}" in ${file.originalName}: ${table.rows.length.toLocaleString()} rows, ${table.headers.length} columns.`,
            safeMetadata: {
              fileName: file.originalName,
              sheetName: table.sheetName,
              rowCount: table.rows.length,
              fieldCount: table.headers.length,
            },
          });
        }

        const profiles = profileTable(table.headers, table.rows);
        const prefix = table.sheetName ? `${table.sheetName}/` : '';

        profiles.forEach((p, col) => {
          const values = table.rows.map((r) => r[col] ?? '');
          allProfiles.push({ profile: { ...p, name: `${prefix}${p.name}` }, values });

          // One evidence chunk per field, holding the summary a finding can later cite. Cell-level
          // chunks are created on demand by the analysis stage, not eagerly for every cell.
          chunkRows.push({
            locatorType: 'field',
            locator: `${file.originalName}${table.sheetName ? `#${table.sheetName}` : ''}/${p.sourceName}`,
            fieldName: `${prefix}${p.name}`,
            value: p.topValues.map((t) => `${t.value} (${t.count})`).join('; ').slice(0, 2000),
            numericValue: p.numeric ? p.numeric.mean : null,
            baseSize: table.rows.length - p.missingCount,
            suppressed: false,
          });
        });

        findings.push(
          ...checkIntegrity({
            originalName: file.originalName,
            encoding: parsed.encoding,
            headers: table.headers,
            rows: table.rows,
            fields: profiles.map((p) => ({
              name: p.name,
              missingPct: p.missingPct,
              distinctCount: p.distinctCount,
              type: p.type,
            })),
            // The caption rows the parser found above the header are where a file states what it
            // actually contains — which is what the filename is checked against.
            internalLabels: [...table.preamble, ...table.headers],
          }),
        );
      }

      await prisma.sourceFile.update({
        where: { id: file.id },
        data: { extractionStatus: 'COMPLETED', parseError: null },
      });
      filesDone += 1;
      await emit({
        eventType: 'rows.parsed',
        stage: 'parsing',
        status: 'active',
        message: `${file.originalName}: ${fileRows.toLocaleString()} rows parsed.`,
        progressCurrent: filesDone,
        progressTotal: version.files.length,
        safeMetadata: { fileName: file.originalName, rowCount: fileRows, sheetCount: parsed.tables.length },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The file could not be parsed.';
      await prisma.sourceFile.update({
        where: { id: file.id },
        data: { extractionStatus: 'FAILED', parseError: message.slice(0, 500) },
      });
      notes.push(`${file.originalName}: ${message}`);
      failedFiles += 1;
      filesDone += 1;
      await emit({
        eventType: 'file.parse.failed',
        stage: 'parsing',
        status: 'warning',
        severity: 'warning',
        message: `${file.originalName} could not be parsed. The reason is shown against the file.`,
        progressCurrent: filesDone,
        progressTotal: version.files.length,
        safeMetadata: { fileName: file.originalName },
      });
    }
  }

  if (!anyParsed) {
    await prisma.datasetVersion.update({
      where: { id: datasetVersionId },
      data: { status: 'FAILED', parseReport: { notes } },
    });
    await emit({
      eventType: 'ingest.stage',
      stage: 'parsing',
      status: 'failed',
      severity: 'error',
      message: 'No file could be parsed, so nothing was ingested. Each file states why.',
      safeMetadata: { fileCount: version.files.length },
    });
    return {
      datasetVersionId,
      status: 'FAILED',
      rowCount: 0,
      fieldCount: 0,
      blockingFindings: 0,
      warningFindings: 0,
      qualityScore: 0,
      notes,
    };
  }

  await emit({
    eventType: 'ingest.stage',
    stage: 'parsing',
    status: failedFiles > 0 ? 'warning' : 'completed',
    message:
      failedFiles > 0
        ? `${totalRows.toLocaleString()} rows parsed; ${failedFiles} file(s) could not be read.`
        : `${totalRows.toLocaleString()} rows parsed from ${version.files.length} file(s).`,
    progressCurrent: totalRows,
    safeMetadata: { rowCount: totalRows, fileCount: version.files.length },
  });

  // ── Schema, profiling, duplicates, missing values, outliers — all computed during parsing above;
  //    reported now, in order, from what was actually computed. ──
  const lowConfidence = allProfiles.filter((p) => p.profile.typeConfidence < 0.75).length;
  enter('schema_detection');
  await emit({
    eventType: 'fields.typed',
    stage: 'schema_detection',
    status: lowConfidence > 0 ? 'warning' : 'completed',
    message:
      `${allProfiles.length} field(s) typed` +
      (lowConfidence > 0 ? `; ${lowConfidence} with type confidence below 0.75 — check them in the field review.` : '.'),
    progressCurrent: allProfiles.length,
    safeMetadata: { fieldCount: allProfiles.length, count: lowConfidence },
  });

  enter('data_profiling');
  await emit({
    eventType: 'fields.profiled',
    stage: 'data_profiling',
    status: 'completed',
    message: `Distinct counts, top values and distributions computed for ${allProfiles.length} field(s).`,
    progressCurrent: allProfiles.length,
  });

  const duplicates = findings.filter((f) => f.check === 'duplicate_rows');
  enter('duplicate_detection');
  await emit({
    eventType: duplicates.length > 0 ? 'duplicate.found' : 'duplicates.checked',
    stage: 'duplicate_detection',
    status: duplicates.length > 0 ? 'warning' : 'completed',
    severity: duplicates.length > 0 ? 'warning' : 'info',
    message: duplicates.length > 0 ? 'Potential duplicate rows found. See the findings to acknowledge them.' : 'No duplicate rows found.',
    safeMetadata: { count: duplicates.length, check: 'duplicate_rows' },
  });

  const withMissing = allProfiles.filter((p) => p.profile.missingCount > 0).length;
  const emptyFields = findings.filter((f) => f.check === 'empty_field').length;
  enter('missing_values');
  await emit({
    eventType: 'missing.identified',
    stage: 'missing_values',
    status: emptyFields > 0 ? 'warning' : 'completed',
    severity: emptyFields > 0 ? 'warning' : 'info',
    message:
      withMissing === 0
        ? 'No missing values in any field.'
        : `${withMissing} field(s) contain missing values` + (emptyFields > 0 ? `; ${emptyFields} are empty or nearly empty.` : '.'),
    progressCurrent: withMissing,
    safeMetadata: { count: withMissing },
  });

  const outliers = allProfiles.reduce((s, p) => s + p.profile.outlierCount, 0);
  enter('outlier_analysis');
  await emit({
    eventType: 'outliers.identified',
    stage: 'outlier_analysis',
    status: 'completed',
    message: outliers === 0 ? 'No outlying values found.' : `${outliers.toLocaleString()} outlying value(s) found across numeric fields.`,
    progressCurrent: outliers,
    safeMetadata: { count: outliers },
  });

  // ── Field mapping and sensitive-field detection. Anything flagged is excluded until a person
  //    says otherwise. ──
  await prisma.datasetVersion.update({
    where: { id: datasetVersionId },
    data: { status: 'DETECTING_SENSITIVE' },
  });

  const floor = allProfiles.map(({ profile, values }) => classifyField(profile.sourceName, values));
  // Optional second opinion from a judge model, on field NAMES only. It can only add flags.
  const second = await secondOpinionOnFields(datasetVersionId, allProfiles.map((p) => p.profile.sourceName), floor);
  const verdicts = second.verdicts;

  enter('field_mapping');
  await prisma.datasetField.deleteMany({ where: { datasetVersionId } });
  await prisma.datasetField.createMany({
    data: allProfiles.map(({ profile }, i) => {
      const verdict = verdicts[i]!;
      return {
        datasetVersionId,
        name: profile.name,
        sourceName: profile.sourceName,
        type: profile.type,
        typeConfidence: profile.typeConfidence,
        scalePoints: profile.scalePoints,
        missingCount: profile.missingCount,
        missingPct: profile.missingPct,
        outlierCount: profile.outlierCount,
        distinctCount: profile.distinctCount,
        sensitivity: verdict.sensitivity,
        sensitivityReason: verdict.reason,
        // The default that matters: flagged fields start excluded.
        excluded: verdict.sensitivity !== 'NONE',
        profile: {
          topValues: profile.topValues,
          numeric: profile.numeric,
          notes: profile.notes,
          detectionSignal: verdict.signal,
        },
      };
    }),
  });
  await emit({
    eventType: 'fields.recognized',
    stage: 'field_mapping',
    status: 'completed',
    message: `${allProfiles.length} field(s) recorded against this version.`,
    progressCurrent: allProfiles.length,
    safeMetadata: { fieldCount: allProfiles.length },
  });

  enter('sensitive_detection');
  const flagged = allProfiles.filter((_, i) => verdicts[i]!.sensitivity !== 'NONE');
  for (const f of flagged.slice(0, 25)) {
    // The field *name* is schema, not content, and is what a reviewer needs to find it.
    await emit({
      eventType: 'field.excluded',
      stage: 'sensitive_detection',
      status: 'warning',
      severity: 'warning',
      message: `"${f.profile.name}" flagged as possibly sensitive and excluded until a person decides otherwise.`,
      safeMetadata: { fieldName: f.profile.name },
    });
  }
  if (second.consulted) {
    await emit({
      eventType: 'judge.second_opinion',
      stage: 'sensitive_detection',
      status: second.added.length > 0 ? 'warning' : 'completed',
      severity: second.added.length > 0 ? 'warning' : 'info',
      message: second.added.length > 0
        ? `Judge-model second opinion (field names only) flagged ${second.added.length} field(s) the in-code checks passed.`
        : 'Judge-model second opinion (field names only) agreed with the in-code checks.',
      progressCurrent: second.added.length,
      safeMetadata: { count: second.added.length },
    });
  }
  await emit({
    eventType: 'ingest.stage',
    stage: 'sensitive_detection',
    status: flagged.length > 0 ? 'warning' : 'completed',
    message:
      flagged.length > 0
        ? `${flagged.length} field(s) flagged and excluded by default. Detection is a floor, not a guarantee.`
        : 'No field was flagged. Detection is a floor, not a guarantee — the field review still applies.',
    progressCurrent: flagged.length,
    safeMetadata: { count: flagged.length },
  });

  await prisma.integrityFinding.deleteMany({ where: { datasetVersionId } });
  if (findings.length > 0) {
    await prisma.integrityFinding.createMany({
      data: findings.map((f) => ({
        datasetVersionId,
        check: f.check,
        severity: f.severity,
        message: f.message,
        detail: (f.detail ?? undefined) as object | undefined,
      })),
    });
  }

  const blockingFindings = findings.filter((f) => f.severity === 'blocking').length;
  const warningFindings = findings.filter((f) => f.severity === 'warning').length;

  enter('quality_assessment');
  const governance = await prisma.governanceRecord.findUnique({ where: { datasetVersionId } });
  const confidentTypes = allProfiles.filter((p) => p.profile.typeConfidence >= 0.75).length;
  const { total, components } = scoreQuality({
    fields: allProfiles.map((p) => ({
      missingPct: p.profile.missingPct,
      type: p.profile.type,
      typeConfidence: p.profile.typeConfidence,
    })),
    rowCount: totalRows,
    collectionEnd: governance?.collectionEnd ?? null,
    hasGovernance: Boolean(governance),
    documentedFieldShare: allProfiles.length === 0 ? 0 : confidentTypes / allProfiles.length,
    blockingFindings,
    warningFindings,
  });

  await prisma.qualityComponent.deleteMany({ where: { datasetVersionId } });
  await prisma.qualityComponent.createMany({
    data: components.map((c) => ({ ...c, datasetVersionId })),
  });
  await emit({
    eventType: 'quality.completed',
    stage: 'quality_assessment',
    status: blockingFindings > 0 ? 'warning' : 'completed',
    severity: blockingFindings > 0 ? 'warning' : 'info',
    message:
      `Quality ${total}/100 across ${components.length} components. ` +
      `${blockingFindings} blocking and ${warningFindings} warning finding(s) to review.`,
    metricName: 'quality_score',
    metricValue: total,
    safeMetadata: { qualityScore: total, blocking: blockingFindings, warnings: warningFindings },
  });

  enter('evidence_preparation');
  await prisma.evidenceChunk.deleteMany({ where: { datasetVersionId } });
  if (chunkRows.length > 0) {
    await prisma.evidenceChunk.createMany({
      data: chunkRows.map((c) => ({ ...c, datasetVersionId })),
    });
  }
  await emit({
    eventType: 'evidence.prepared',
    stage: 'evidence_preparation',
    status: 'completed',
    message: `${chunkRows.length} field summaries prepared for citation.`,
    progressCurrent: chunkRows.length,
    safeMetadata: { count: chunkRows.length },
  });

  const status = notes.some((n) => n.includes('could not be')) ? 'PARTIALLY_IMPORTED' : 'READY_FOR_REVIEW';

  await prisma.datasetVersion.update({
    where: { id: datasetVersionId },
    data: {
      status,
      checksum: hasher.digest('hex'),
      rowCount: totalRows,
      cellCount: totalCells,
      qualityScore: total,
      parseReport: { notes, fieldCount: allProfiles.length, findingCount: findings.length },
    },
  });

  enter('ready_for_review');
  await emit({
    eventType: 'version.ready',
    stage: 'ready_for_review',
    status: status === 'PARTIALLY_IMPORTED' ? 'warning' : 'completed',
    message:
      status === 'PARTIALLY_IMPORTED'
        ? 'Dataset version created from the files that could be read. Ready for your review.'
        : 'Dataset version created. Ready for your review.',
    safeMetadata: { rowCount: totalRows, fieldCount: allProfiles.length },
  });
  await emit({
    eventType: 'import.awaiting_approval',
    stage: 'import_approved',
    status: 'pending',
    message: 'Waiting for a person to acknowledge findings, confirm the field review and record provenance.',
  });

  return {
    datasetVersionId,
    status,
    rowCount: totalRows,
    fieldCount: allProfiles.length,
    blockingFindings,
    warningFindings,
    qualityScore: total,
    notes,
  };
}

/**
 * Record that a version became usable, once. Called after every governance action; emits nothing
 * until all four conditions hold, and nothing again after it has said so.
 */
export async function emitApprovalIfUsable(datasetVersionId: string, actor?: string): Promise<void> {
  const verdict = await assessUsability(datasetVersionId);
  const already = await prisma.telemetryEvent.findFirst({
    where: { datasetVersionId, stage: 'import_approved', status: 'completed' },
    select: { seq: true },
  });
  const emit = await datasetEmitter(datasetVersionId);
  if (verdict.usable && !already) {
    await emit({
      eventType: 'import.approved',
      stage: 'import_approved',
      status: 'completed',
      message: `Import approved${actor ? ` by ${actor}` : ''}: findings acknowledged, fields confirmed, provenance recorded and model processing permitted.`,
    });
  } else if (!verdict.usable) {
    await emit({
      eventType: 'import.review.progress',
      stage: 'import_approved',
      status: 'pending',
      message: `${verdict.blockers.length} condition(s) still outstanding before this data can be used.`,
      progressCurrent: verdict.blockers.length,
    });
  }
}

/**
 * Whether a dataset version may be used in a run.
 *
 * Four conditions, each of which has to be true for a separate reason. The function returns every
 * unmet one rather than the first, so a user fixes them in one pass instead of discovering them
 * one at a time.
 */
export interface UsabilityVerdict {
  usable: boolean;
  blockers: string[];
}

export async function assessUsability(datasetVersionId: string): Promise<UsabilityVerdict> {
  const version = await prisma.datasetVersion.findUnique({
    where: { id: datasetVersionId },
    include: { governance: true, integrity: true, fields: true },
  });
  if (!version) return { usable: false, blockers: ['This dataset version no longer exists.'] };

  const blockers: string[] = [];

  if (version.status !== 'IMPORTED' && version.status !== 'READY_FOR_REVIEW') {
    blockers.push(`Ingestion is at "${version.status.toLowerCase().replace(/_/g, ' ')}", not finished.`);
  }

  const unacknowledgedBlocking = version.integrity.filter(
    (f) => f.severity === 'blocking' && !f.acknowledgedAt,
  );
  for (const f of unacknowledgedBlocking) {
    blockers.push(`Unresolved blocking finding: ${f.message}`);
  }

  const unacknowledgedWarnings = version.integrity.filter(
    (f) => f.severity === 'warning' && !f.acknowledgedAt,
  );
  if (unacknowledgedWarnings.length > 0) {
    blockers.push(
      `${unacknowledgedWarnings.length} warning finding(s) have not been acknowledged by anyone.`,
    );
  }

  if (!version.governance) {
    blockers.push('No governance record: the source, methodology and lawful basis are unstated.');
  } else {
    if (!version.governance.sensitiveConfirmed) {
      blockers.push('Field sensitivity has not been reviewed and confirmed.');
    }
    if (!version.governance.allowModelProcessing) {
      blockers.push(
        'Model processing has not been permitted for this data. Until it is, no field from this ' +
          'dataset may be placed in a model prompt.',
      );
    }
    if (version.governance.expiresAt && version.governance.expiresAt.getTime() < Date.now()) {
      blockers.push('The retention period recorded for this data has expired.');
    }
  }

  const includedSensitive = version.fields.filter(
    (f) => f.sensitivity !== 'NONE' && !f.excluded && !f.inclusionJustification,
  );
  if (includedSensitive.length > 0) {
    blockers.push(
      `${includedSensitive.length} sensitive field(s) are included without a written justification.`,
    );
  }

  return { usable: blockers.length === 0, blockers };
}
