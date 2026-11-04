/**
 * Decision guidance at a checkpoint: the latest answers from the OpenAI Decisions API, with their
 * probabilities, and a button to ask again. Guidance only — nothing is gated on it.
 */
import { CHOICE_LABEL, QUESTION_LABEL, latestGuidance, type Checkpoint, type DecisionAnswer } from '@/decision/checkpoints';
import type { DecisionQuestion } from '@/decision/client';
import { fmtDateTime, TZ_LABEL } from '@/lib/time';
import { GuidanceButton } from './GuidanceButton';
import { projectModules } from '@/modules/project';

const pct = (p: number) => `${Math.round(p * 100)}%`;

function Answer({ q, a }: { q: DecisionQuestion; a: DecisionAnswer | undefined }) {
  const label = QUESTION_LABEL[q.name] ?? q.name;
  if (!a) return null;
  if (a.refused) return <li className="text-sm text-ink-muted">{label}: <span className="text-warn">declined to answer</span></li>;
  if (q.type === 'predicate') {
    const p = a.probability ?? 0;
    return (
      <li className="flex flex-col gap-1">
        <span className="text-sm text-ink">{label}</span>
        <span className="flex items-center gap-2">
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-track"><span className="block h-full bg-brand-mark" style={{ width: pct(p) }} /></span>
          <span className="w-24 shrink-0 text-right text-xs font-semibold text-ink">{`${pct(p)} likely`}</span>
        </span>
      </li>
    );
  }
  if (q.type === 'choice') {
    const probs = Object.entries(a.probabilities ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 4);
    return (
      <li className="flex flex-col gap-1">
        <span className="text-sm text-ink">
          {label}: <b className="text-brand">{CHOICE_LABEL[a.choice ?? ''] ?? a.choice ?? '—'}</b>
        </span>
        {probs.length > 1 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-subtle">
            {probs.map(([k, p]) => <li key={k}>{`${CHOICE_LABEL[k] ?? k} ${pct(p)}`}</li>)}
          </ul>
        )}
      </li>
    );
  }
  const levels = q.levels.map((l) => l.label);
  const s = a.score ?? 0;
  const nearest = levels[Math.max(0, Math.min(levels.length - 1, Math.round(s)))];
  return (
    <li className="flex flex-col gap-1">
      <span className="text-sm text-ink">
        {label}: <b className="text-brand">{nearest}</b> <span className="text-xs text-ink-subtle">{`(${s.toFixed(2)} on 0–${levels.length - 1})`}</span>
      </span>
    </li>
  );
}

export async function DecisionGuidance({ projectId, checkpoint, subjectId, canAsk, title = 'Decision guidance' }: { projectId: string; checkpoint: Checkpoint; subjectId?: string; canAsk: boolean; title?: string }) {
  if (!(await projectModules(projectId)).has('decisions')) return null;
  const g = await latestGuidance(projectId, checkpoint, subjectId);
  const questions = (g?.questions ?? []) as unknown as DecisionQuestion[];
  const answers = (g?.answers ?? []) as unknown as DecisionAnswer[];
  return (
    <section aria-label={title} className="panel border-l-4 border-l-[var(--color-highlight)] px-4 py-3" data-checkpoint={checkpoint}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{title}</p>
          <p className="text-xs text-ink-subtle">
            {g ? `${g.isMock ? 'Local stand-in (no OpenAI key set)' : `OpenAI Decisions API · ${g.modelId}`} · ${fmtDateTime(g.createdAt)} ${TZ_LABEL}` : 'Ask the Decisions API what to do next at this point.'}
          </p>
        </div>
        {canAsk && <GuidanceButton projectId={projectId} checkpoint={checkpoint} subjectId={subjectId} label={g ? 'Ask again' : 'Get decision guidance'} />}
      </div>
      {g?.status === 'FAILED' && <p className="mt-2 rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{g.error}</p>}
      {g?.status === 'COMPLETED' && (
        <ul className="mt-3 flex flex-col gap-3">
          {questions.map((q) => <Answer key={q.name} q={q} a={answers.find((a) => a.name === q.name)} />)}
        </ul>
      )}
      {g?.isMock && g.status === 'COMPLETED' && <p className="mt-2 text-xs text-warn">These answers come from a local stand-in, not the Decisions API. Set OPENAI_API_KEY in Railway to use gpt-6-luna.</p>}
    </section>
  );
}
