'use server';

/**
 * Server actions for the simplified journey: brief, cast, roundtable and market inputs.
 *
 * Each repeats authentication and authorization — a server action is reachable at a public URL
 * whatever component calls it.
 */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { requireUserApi, AuthorizationError } from '@/auth/guard';
import { LANG_COOKIE, parseLang } from '@/ui/i18n/translate';
import { EvidenceRefused } from '@/model/context';
import { ApprovalRefused } from '@/server/personas';
import {
  approveCast,
  JourneyRefused,
  renameCastPersona,
  requestCast,
  requestRoundtable,
  saveMarketInputs,
  saveStudyBrief,
} from '@/roundtable/service';
import { PILLARS } from '@/roundtable/marketIndex';
import { CHECKPOINTS, requestGuidance, type Checkpoint } from '@/decision/checkpoints';
import type { FormState } from './actions';

function toState(e: unknown): FormState {
  if (e instanceof AuthorizationError) return { error: 'You do not have permission to do that in this project.' };
  if (e instanceof JourneyRefused || e instanceof ApprovalRefused) return { problems: e.problems };
  if (e instanceof EvidenceRefused) return { error: e.message };
  console.error('[journey action] unexpected failure', e);
  return { error: 'That could not be completed. The failure has been recorded.' };
}

async function lang() {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}

function refresh(projectId: string) {
  for (const step of ['brief', 'personas', 'simulate', 'results']) revalidatePath(`/projects/${projectId}/${step}`);
}

export async function saveStudyBriefAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await requireUserApi();
    await saveStudyBrief(user, projectId, {
      context: String(formData.get('context') ?? ''),
      markets: formData.getAll('markets').map(String),
      question: String(formData.get('question') ?? ''),
      categories: String(formData.get('categories') ?? '').split('\n'),
      audience: String(formData.get('audience') ?? ''),
    });
  } catch (e) {
    return toState(e);
  }
  refresh(projectId);
  return { ok: 'Brief saved.' };
}

export async function buildCastAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await requireUserApi();
    await requestCast(user, projectId, await lang(), { markets: formData.getAll('markets').map(String), groups: formData.getAll('groups').map(String) });
  } catch (e) {
    return toState(e);
  }
  refresh(projectId);
  return { ok: 'Building the cast. This page updates as it progresses.' };
}

export async function approveCastAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await requireUserApi();
    await approveCast(user, projectId, String(formData.get('cohortId') ?? ''));
  } catch (e) {
    return toState(e);
  }
  refresh(projectId);
  return { ok: 'Cast approved.' };
}

export async function renamePersonaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await requireUserApi();
    await renameCastPersona(user, projectId, String(formData.get('personaId') ?? ''), String(formData.get('name') ?? ''));
  } catch (e) {
    return toState(e);
  }
  refresh(projectId);
  return { ok: 'Saved.' };
}

export async function startRoundtableAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await requireUserApi();
    await requestRoundtable(user, projectId, await lang());
  } catch (e) {
    return toState(e);
  }
  refresh(projectId);
  return { ok: 'The roundtable has started. This page updates as personas answer.' };
}

export async function saveMarketInputsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await requireUserApi();
    const markets = formData.getAll('market').map(String);
    const num = (v: FormDataEntryValue | null) => {
      const s = String(v ?? '').trim();
      return s === '' ? null : Number(s);
    };
    const rows = markets.map((market, i) => ({
      market,
      source: String(formData.getAll('source')[i] ?? ''),
      ...Object.fromEntries(PILLARS.map((p) => [p, num(formData.getAll(p)[i] ?? null)])),
    }));
    await saveMarketInputs(user, projectId, rows);
  } catch (e) {
    return toState(e);
  }
  refresh(projectId);
  return { ok: 'Market inputs saved.' };
}

export async function guidanceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  const checkpoint = String(formData.get('checkpoint') ?? '') as Checkpoint;
  try {
    if (!(CHECKPOINTS as readonly string[]).includes(checkpoint)) return { error: 'Invalid request.' };
    const user = await requireUserApi();
    const r = await requestGuidance(user, projectId, checkpoint, String(formData.get('subjectId') ?? '') || undefined);
    if (r.status === 'FAILED') return { error: r.error ?? 'Decision guidance could not be produced.' };
  } catch (e) {
    return toState(e);
  }
  for (const step of ['data', 'brief', 'personas', 'simulate', 'results']) revalidatePath(`/projects/${projectId}/${step}`);
  return {};
}

export async function askPersonaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  const personaId = String(formData.get('personaId') ?? '');
  try {
    const user = await requireUserApi();
    const { askPersona } = await import('@/roundtable/interview');
    const chat = await askPersona(user, projectId, personaId, String(formData.get('question') ?? ''), await lang());
    if (!chat.ok) return { error: 'The persona could not answer that just now. Try again, or rephrase the question.' };
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/projects/${projectId}/personas/${personaId}`);
  return { ok: 'Answered.' };
}

export async function requestPlanAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await requireUserApi();
    const { requestPlan } = await import('@/advice/planner');
    await requestPlan(user, projectId, { question: String(formData.get('question') ?? ''), industry: String(formData.get('industry') ?? '') || undefined, language: await lang() });
  } catch (e) {
    return toState(e);
  }
  revalidatePath(`/projects/${projectId}/results`);
  return { ok: 'Writing the plan. It appears below in a minute or two.' };
}

export async function saveModulesAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const projectId = String(formData.get('projectId') ?? '');
  try {
    const user = await requireUserApi();
    const { saveProjectModules } = await import('@/modules/project');
    await saveProjectModules(user, projectId, String(formData.get('useCase') ?? ''), formData.getAll('modules').map(String));
  } catch (e) {
    return toState(e);
  }
  for (const step of ['data', 'brief', 'personas', 'simulate', 'results']) revalidatePath(`/projects/${projectId}/${step}`);
  return { ok: 'Set-up saved.' };
}
