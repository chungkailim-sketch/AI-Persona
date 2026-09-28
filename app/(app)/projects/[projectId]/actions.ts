'use server';

/**
 * Server actions for the project workflow.
 *
 * Each repeats authentication and authorization. Next exposes every server action at a generated
 * public URL, so "it is only called from this component" is a statement about the UI, not about who
 * can reach it.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { requireUserApi, AuthorizationError } from '@/auth/guard';
import { clientIp } from '@/lib/request';
import {
  createDatasetWithVersion,
  retryIngestion,
  UploadRejected,
  type UploadedFile,
} from '@/server/datasets';
import {
  acknowledgeFinding,
  confirmFieldReview,
  recordGovernance,
  GovernanceRefused,
  type FieldDecision,
} from '@/server/governance';
import {
  addHypothesis,
  addStimulus,
  removeHypothesis,
  saveBrief,
  BriefRefused,
} from '@/server/brief';

import { requestForecastAnalysis } from '@/forecast/analysis';
import { buildPopulationSample, createCohortFromPopulation, PopulationRefused } from '@/population/service';
import { EvidenceRefused } from '@/model/context';
import { runAdherenceCheck } from '@/run/adherenceService';
import { requestDebate, DebateRequestRefused } from '@/debate/service';

export interface FormState {
  error?: string;
  problems?: string[];
  ok?: string;
}

function toState(e: unknown): FormState {
  if (e instanceof AuthorizationError) {
    return { error: 'You do not have permission to do that in this project.' };
  }
  if (e instanceof GovernanceRefused || e instanceof BriefRefused || e instanceof PopulationRefused || e instanceof DebateRequestRefused) {
    return { problems: e.problems };
  }
  if (e instanceof UploadRejected) return { error: e.message };
  // Anything else is unexpected. The message is not shown, because it can name uploaded fields.
  console.error('[action] unexpected failure', e);
  return { error: 'That could not be completed. The failure has been recorded.' };
}

// ── Step 1: data ──────────────────────────────────────────────────────────────

export async function uploadDatasetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (!projectId) return { error: 'Invalid request.' };
    if (name.length < 2) return { error: 'Give the dataset a name.' };

    const entries = formData.getAll('files').filter((f): f is File => f instanceof File);
    const files: UploadedFile[] = [];
    for (const f of entries) {
      if (f.size === 0) continue;
      files.push({
        originalName: f.name,
        mimeType: f.type || 'application/octet-stream',
        bytes: Buffer.from(await f.arrayBuffer()),
      });
    }
    if (files.length === 0) return { error: 'Choose at least one file.' };

    const h = await headers();
    await createDatasetWithVersion(
      user,
      projectId,
      { name, files, changeNote: String(formData.get('changeNote') ?? '') },
      { ip: clientIp(h) },
    );

    revalidatePath(`/projects/${projectId}/data`);
    return { ok: 'Upload accepted. Ingestion is running; this page updates as it progresses.' };
  } catch (e) {
    return toState(e);
  }
}

export async function retryIngestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const versionId = String(formData.get('datasetVersionId') ?? '');
    if (!projectId || !versionId) return { error: 'Invalid request.' };
    await retryIngestion(user, projectId, versionId);
    revalidatePath(`/projects/${projectId}/data`);
    return { ok: 'Ingestion queued again. The pipeline below follows it.' };
  } catch (e) {
    return toState(e);
  }
}

const GovernanceSchema = z.object({
  dataOwner: z.string().trim().min(2, 'Name the person or team accountable for this data.'),
  sourceName: z.string().trim().min(2, 'Name the source.'),
  methodology: z
    .string()
    .trim()
    .min(20, 'Describe how the data was collected, in enough detail to judge what it supports.'),
  collectionStart: z.string().optional(),
  collectionEnd: z.string().optional(),
  geography: z.string().optional(),
  language: z.string().optional(),
  sampleSize: z.string().optional(),
  lawfulBasis: z.enum([
    'CONSENT',
    'CONTRACT',
    'LEGITIMATE_INTEREST',
    'PUBLIC_TASK',
    'LEGAL_OBLIGATION',
    'NOT_APPLICABLE_AGGREGATE',
  ]),
  classification: z.enum(['PUBLIC', 'INTERNAL', 'CLIENT_CONFIDENTIAL', 'RESTRICTED']),
  permittedUses: z.string().optional(),
  restrictions: z.string().optional(),
  retentionDays: z.coerce.number().int().min(1).max(3650),
});

function splitList(v: FormDataEntryValue | null): string[] {
  return String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function optionalDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function saveGovernanceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const datasetVersionId = String(formData.get('datasetVersionId') ?? '');
    if (!projectId || !datasetVersionId) return { error: 'Invalid request.' };

    const parsed = GovernanceSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { problems: parsed.error.issues.map((i) => i.message) };
    }

    const h = await headers();
    await recordGovernance(
      user,
      projectId,
      datasetVersionId,
      {
        dataOwner: parsed.data.dataOwner,
        sourceName: parsed.data.sourceName,
        methodology: parsed.data.methodology,
        collectionStart: optionalDate(parsed.data.collectionStart),
        collectionEnd: optionalDate(parsed.data.collectionEnd),
        geography: splitList(formData.get('geography')),
        language: splitList(formData.get('language')),
        sampleSize: parsed.data.sampleSize ? Number(parsed.data.sampleSize) : null,
        lawfulBasis: parsed.data.lawfulBasis,
        classification: parsed.data.classification,
        permittedUses: splitList(formData.get('permittedUses')),
        restrictions: parsed.data.restrictions ?? null,
        retentionDays: parsed.data.retentionDays,
        // Checkbox semantics: absent means false. The flag is never set by omission.
        allowModelProcessing: formData.get('allowModelProcessing') === 'on',
      },
      { ip: clientIp(h) },
    );

    revalidatePath(`/projects/${projectId}/data`);
    return { ok: 'Provenance recorded.' };
  } catch (e) {
    return toState(e);
  }
}

export async function confirmFieldsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const datasetVersionId = String(formData.get('datasetVersionId') ?? '');
    const fieldIds = formData.getAll('fieldId').map(String);
    if (!projectId || !datasetVersionId || fieldIds.length === 0) {
      return { error: 'Invalid request.' };
    }

    const decisions: FieldDecision[] = fieldIds.map((id) => {
      const grade = String(formData.get(`grade:${id}`) ?? '');
      return {
        fieldId: id,
        // An unchecked "include" box means excluded. Silence never includes a field.
        excluded: formData.get(`include:${id}`) !== 'on',
        inclusionJustification: String(formData.get(`why:${id}`) ?? ''),
        redacted: formData.get(`redact:${id}`) === 'on',
        constructMappingGrade:
          grade === 'direct' || grade === 'partial' || grade === 'weak' ? grade : null,
      };
    });

    const h = await headers();
    await confirmFieldReview(user, projectId, datasetVersionId, decisions, { ip: clientIp(h) });
    revalidatePath(`/projects/${projectId}/data`);
    return { ok: 'Field review confirmed.' };
  } catch (e) {
    return toState(e);
  }
}

export async function acknowledgeFindingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const findingId = String(formData.get('findingId') ?? '');
    const note = String(formData.get('note') ?? '');
    if (!projectId || !findingId) return { error: 'Invalid request.' };

    const h = await headers();
    await acknowledgeFinding(user, projectId, findingId, note, { ip: clientIp(h) });
    revalidatePath(`/projects/${projectId}/data`);
    return { ok: 'Acknowledged.' };
  } catch (e) {
    return toState(e);
  }
}

// ── Step 2: brief ─────────────────────────────────────────────────────────────

export async function saveBriefAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const briefId = String(formData.get('briefId') ?? '');
    if (!projectId || !briefId) return { error: 'Invalid request.' };

    const h = await headers();
    await saveBrief(
      user,
      projectId,
      briefId,
      {
        businessContext: String(formData.get('businessContext') ?? ''),
        researchQuestion: String(formData.get('researchQuestion') ?? ''),
        objective: String(formData.get('objective') ?? ''),
        decisionSupported: String(formData.get('decisionSupported') ?? ''),
        targetAudience: String(formData.get('targetAudience') ?? ''),
        markets: splitList(formData.get('markets')),
        timePeriod: String(formData.get('timePeriod') ?? ''),
        competitors: splitList(formData.get('competitors')),
        desiredOutcome: String(formData.get('desiredOutcome') ?? ''),
        constraints: String(formData.get('constraints') ?? ''),
        exclusions: splitList(formData.get('exclusions')),
        prohibitedInferences: splitList(formData.get('prohibitedInferences')),
        personaCount: Number(formData.get('personaCount') ?? 12),
        runCount: Number(formData.get('runCount') ?? 3),
        simulationDepth:
          (String(formData.get('simulationDepth') ?? 'standard') as 'quick' | 'standard' | 'deep'),
        confidenceRequirement: String(formData.get('confidenceRequirement') ?? ''),
        reportAudience: String(formData.get('reportAudience') ?? ''),
      },
      { ip: clientIp(h) },
    );

    revalidatePath(`/projects/${projectId}/brief`);
    return { ok: 'Brief saved.' };
  } catch (e) {
    return toState(e);
  }
}

export async function addHypothesisAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const briefId = String(formData.get('briefId') ?? '');
    if (!projectId || !briefId) return { error: 'Invalid request.' };

    const h = await headers();
    await addHypothesis(
      user,
      projectId,
      briefId,
      {
        label: String(formData.get('label') ?? ''),
        statement: String(formData.get('statement') ?? ''),
        operationalDefinition: String(formData.get('operationalDefinition') ?? ''),
        nullHypothesis: String(formData.get('nullHypothesis') ?? ''),
        minimumEvidenceThreshold: String(formData.get('minimumEvidenceThreshold') ?? ''),
        alternativeExplanations: splitList(formData.get('alternativeExplanations')),
      },
      { ip: clientIp(h) },
    );

    revalidatePath(`/projects/${projectId}/brief`);
    return { ok: 'Hypothesis added.' };
  } catch (e) {
    return toState(e);
  }
}

export async function removeHypothesisAction(formData: FormData): Promise<void> {
  const user = await requireUserApi();
  const projectId = String(formData.get('projectId') ?? '');
  const hypothesisId = String(formData.get('hypothesisId') ?? '');
  if (!projectId || !hypothesisId) return;
  const h = await headers();
  await removeHypothesis(user, projectId, hypothesisId, { ip: clientIp(h) });
  revalidatePath(`/projects/${projectId}/brief`);
}

export async function addStimulusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const briefId = String(formData.get('briefId') ?? '');
    if (!projectId || !briefId) return { error: 'Invalid request.' };

    const h = await headers();
    await addStimulus(
      user,
      projectId,
      briefId,
      {
        label: String(formData.get('label') ?? ''),
        name: String(formData.get('name') ?? ''),
        content: String(formData.get('content') ?? ''),
      },
      { ip: clientIp(h) },
    );

    revalidatePath(`/projects/${projectId}/brief`);
    return { ok: 'Stimulus added.' };
  } catch (e) {
    return toState(e);
  }
}

// ── Step 1: trends and the forecast gate ──────────────────────────────────────

export async function requestTrendAnalysisAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const datasetVersionId = String(formData.get('datasetVersionId') ?? '');
    if (!projectId || !datasetVersionId) return { error: 'Invalid request.' };
    const horizon = Number(formData.get('horizon') ?? 1);
    const groups = formData.getAll('groups').map(String).filter(Boolean);
    await requestForecastAnalysis(user, projectId, datasetVersionId, { horizon, groups: groups.length ? groups : undefined });
    revalidatePath(`/projects/${projectId}/data`);
    return { ok: 'Analysis queued. The result appears here when the worker has finished; the activity log records each step.' };
  } catch (e) {
    return toState(e);
  }
}

// ── Step 3: population sample ─────────────────────────────────────────────────

export async function buildPopulationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const datasetVersionId = String(formData.get('datasetVersionId') ?? '');
    if (!projectId || !datasetVersionId) return { error: 'Invalid request.' };
    const secondary = String(formData.get('secondaryGroup') ?? '').trim();
    const { result } = await buildPopulationSample(user, projectId, datasetVersionId, {
      size: Number(formData.get('size') ?? 0),
      seed: Number(formData.get('seed') ?? 0),
      primaryGroup: String(formData.get('primaryGroup') ?? '').trim(),
      secondaryGroup: secondary || null,
    });
    revalidatePath(`/projects/${projectId}/personas`);
    return { ok: `Built ${result.members.toLocaleString()} simulated members from ${result.wave}.` };
  } catch (e) {
    return toState(e);
  }
}

export async function cohortFromPopulationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const sampleId = String(formData.get('sampleId') ?? '');
    if (!projectId || !sampleId) return { error: 'Invalid request.' };
    const r = await createCohortFromPopulation(user, projectId, sampleId, {
      personaCount: Number(formData.get('personaCount') ?? 0),
      name: String(formData.get('name') ?? ''),
    });
    revalidatePath(`/projects/${projectId}/personas`);
    return { ok: `Cohort created with ${r.personaCount} candidate personas covering ${Math.round(r.coveredShare * 100)}% of the population. Review and approve it below.` };
  } catch (e) {
    if (e instanceof EvidenceRefused) return { problems: e.reasons };
    return toState(e);
  }
}

export async function adherenceCheckAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const cohortId = String(formData.get('cohortId') ?? '');
    if (!projectId || !cohortId) return { error: 'Invalid request.' };
    const r = await runAdherenceCheck(user, projectId, cohortId);
    revalidatePath(`/projects/${projectId}/personas`);
    return r.status === 'pass' ? { ok: r.reason } : { problems: [r.reason] };
  } catch (e) {
    if (e instanceof EvidenceRefused) return { problems: e.reasons };
    return toState(e);
  }
}

// ── Step 3: persona agent-swarm debate ────────────────────────────────────────

export async function startDebateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  let debateId: string;
  try {
    const user = await requireUserApi();
    if (!projectId) return { error: 'Invalid request.' };
    const focus = String(formData.get('focusSegments') ?? '')
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    ({ debateId } = await requestDebate(user, projectId, {
      cohortId: String(formData.get('cohortId') ?? ''),
      topic: String(formData.get('topic') ?? ''),
      hypothesis: String(formData.get('hypothesis') ?? ''),
      focusSegments: focus,
      rounds: Number(formData.get('rounds') ?? 2),
      contextRunId: String(formData.get('contextRunId') ?? '') || null,
    }));
  } catch (e) {
    return toState(e);
  }
  // Outside the try: a redirect is thrown, and must not be caught as a failure.
  redirect(`/projects/${projectId}/personas?debate=${debateId}#debate`);
}
