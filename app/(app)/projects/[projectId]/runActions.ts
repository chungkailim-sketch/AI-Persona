'use server';

/**
 * Server actions for steps 3 and 4.
 *
 * As everywhere, each repeats authentication and authorization: a server action is a public
 * endpoint at a generated URL, and being called from a component is not a security property.
 */
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requireUserApi, AuthorizationError } from '@/auth/guard';
import { clientIp } from '@/lib/request';
import { createCohort, approveCohort, ApprovalRefused } from '@/server/personas';
import { EvidenceRefused } from '@/model/context';
import { confirmRun, createRun, planRun, requestCancel, RunRefused } from '@/server/runs';

export interface RunFormState {
  error?: string;
  problems?: string[];
  ok?: string;
}

function toState(e: unknown): RunFormState {
  if (e instanceof AuthorizationError) {
    return { error: 'You do not have permission to do that in this project.' };
  }
  if (e instanceof EvidenceRefused) return { problems: e.reasons };
  if (e instanceof RunRefused) return { problems: e.reasons };
  if (e instanceof ApprovalRefused) return { problems: e.problems };
  console.error('[run action] unexpected failure', e);
  return { error: 'That could not be completed. The failure has been recorded.' };
}

export async function generateCohortAction(
  _prev: RunFormState,
  formData: FormData,
): Promise<RunFormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const datasetVersionId = String(formData.get('datasetVersionId') ?? '');
    const personaCount = Number(formData.get('personaCount') ?? 12);
    const seed = Number(formData.get('seed') ?? 42);
    if (!projectId || !datasetVersionId) return { error: 'Choose a dataset first.' };
    if (!Number.isFinite(personaCount) || personaCount < 3 || personaCount > 60) {
      return { error: 'The cohort must be between 3 and 60 personas.' };
    }

    const h = await headers();
    const result = await createCohort(
      user,
      projectId,
      { datasetVersionId, personaCount, seed: Number.isFinite(seed) ? seed : 42 },
      { ip: clientIp(h) },
    );

    revalidatePath(`/projects/${projectId}/personas`);
    return {
      ok: `${result.personaCount} personas generated.${result.note ? ` ${result.note}` : ''}`,
    };
  } catch (e) {
    return toState(e);
  }
}

export async function approveCohortAction(
  _prev: RunFormState,
  formData: FormData,
): Promise<RunFormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const cohortId = String(formData.get('cohortId') ?? '');
    if (!projectId || !cohortId) return { error: 'Invalid request.' };

    const h = await headers();
    const { approved } = await approveCohort(user, projectId, cohortId, { ip: clientIp(h) });
    revalidatePath(`/projects/${projectId}/personas`);
    revalidatePath(`/projects/${projectId}/simulate`);
    return {
      ok:
        `${approved} persona version(s) approved and now immutable. Changing one creates a new ` +
        'version rather than editing this one.',
    };
  } catch (e) {
    return toState(e);
  }
}

/** Creates the run in DRAFT with its estimate. Makes no model call. */
export async function planRunAction(_prev: RunFormState, formData: FormData): Promise<RunFormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const cohortId = String(formData.get('cohortId') ?? '');
    if (!projectId || !cohortId) return { error: 'Choose a cohort first.' };

    const seedRaw = Number(formData.get('seed') ?? 42);
    const plan = await planRun(user, projectId, cohortId, {
      seed: Number.isFinite(seedRaw) ? seedRaw : 42,
    });

    const h = await headers();
    await createRun(user, projectId, plan, { ip: clientIp(h) });
    revalidatePath(`/projects/${projectId}/simulate`);
    return {
      ok: 'Plan prepared. Nothing has run yet — review the estimate below and confirm to start.',
    };
  } catch (e) {
    return toState(e);
  }
}

export async function confirmRunAction(
  _prev: RunFormState,
  formData: FormData,
): Promise<RunFormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const runId = String(formData.get('runId') ?? '');
    const planHash = String(formData.get('planHash') ?? '');
    if (!projectId || !runId || !planHash) return { error: 'Invalid request.' };

    const h = await headers();
    await confirmRun(user, projectId, runId, planHash, { ip: clientIp(h) });
    revalidatePath(`/projects/${projectId}/simulate`);
    return { ok: 'Confirmed and queued. Progress appears below as each stage completes.' };
  } catch (e) {
    return toState(e);
  }
}

export async function cancelRunAction(formData: FormData): Promise<void> {
  const user = await requireUserApi();
  const projectId = String(formData.get('projectId') ?? '');
  const runId = String(formData.get('runId') ?? '');
  if (!projectId || !runId) return;
  const h = await headers();
  await requestCancel(user, projectId, runId, { ip: clientIp(h) });
  revalidatePath(`/projects/${projectId}/simulate`);
}
