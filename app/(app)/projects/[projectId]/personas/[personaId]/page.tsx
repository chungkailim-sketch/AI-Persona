import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { loadCastPersona, personaChats } from '@/roundtable/interview';
import { segmentLine, type CastProfile, type ScoredCategory } from '@/roundtable/engine';
import { band } from '@/roundtable/marketIndex';
import { PersonaAvatar } from '@/ui/report/PersonaCard';
import { WorkflowNav } from '../../WorkflowNav';
import { InterviewForm } from './InterviewForm';
import { projectModules } from '@/modules/project';

export const metadata = { title: 'Persona · RF AI Persona Intelligence' };
export const dynamic = 'force-dynamic';

/** One persona: who it stands for, what the data says about it, and an interview with it. */
export default async function PersonaPage(props: PageProps<'/projects/[projectId]/personas/[personaId]'>) {
  const { projectId, personaId } = await props.params;
  const user = await requireUser(`/projects/${projectId}/personas/${personaId}`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();
  const [project, persona] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
    loadCastPersona(projectId, personaId),
  ]);
  const profile = persona?.versions[0]?.profile as unknown as CastProfile | null;
  if (!project || !persona || !profile) notFound();
  const [chats, said] = await Promise.all([
    personaChats(projectId, personaId),
    prisma.roundtableAnswer.findFirst({ where: { personaId, ok: true }, orderBy: { createdAt: 'desc' } }),
  ]);
  const id = profile.identity;
  const scores = ((said?.scores ?? []) as unknown as ScoredCategory[]).slice().sort((a, b) => b.score - a.score);
  const canAsk = can(ctx, 'simulation.run', projectId) && (await projectModules(projectId)).has('interviews');

  return (
    <div className="flex flex-col gap-6">
      <WorkflowNav projectId={projectId} projectName={project.name} current="PERSONAS" />
      <Link href={`/projects/${projectId}/personas` as Route} className="text-sm text-link underline-offset-2 hover:underline">← All personas</Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4">
          <section className="panel flex flex-col gap-3 px-5 py-5">
            <div className="flex items-center gap-4">
              <PersonaAvatar name={persona.name} profile={profile} size={72} />
              <div className="min-w-0">
                <h1 className="text-2xl leading-tight">{persona.name}{id?.age ? <span className="font-medium text-ink-muted">{` • ${id.age}`}</span> : null}</h1>
                {id && <p className="text-sm text-ink-muted">{[id.occupation, id.city].filter(Boolean).join(' · ')}</p>}
                {id?.lifeStage && <p className="text-sm text-ink-subtle">{id.lifeStage}</p>}
              </div>
            </div>
            <p className="text-xs text-ink-subtle">{`${profile.market} · ${segmentLine(profile)} · base n=${profile.base} · illustrative persona`}</p>
            {id?.decisionLogic?.length ? <p className="rounded-sm bg-brand-soft px-2 py-1 text-sm font-semibold text-brand">{id.decisionLogic.join(' > ')}</p> : null}
            {id?.oneLiner && <p className="text-sm text-ink">{id.oneLiner}</p>}
          </section>

          <section className="panel px-5 py-4">
            <h2 className="eyebrow">What the data says</h2>
            <ul className="mt-2 flex flex-col gap-2 text-sm">
              {profile.stats.map((s) => (
                <li key={s.id} className="flex gap-2">
                  <span className="w-12 shrink-0 text-right font-bold text-brand">{`${Math.round(s.share)}%`}</span>
                  <span className="text-ink-muted">
                    {s.statement}{s.response && !/^agree$/i.test(s.response) ? ` — ${s.response}` : ''}
                    <span className="text-ink-subtle">{` (vs ${Math.round(s.overall)}% of all adults)`}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {said && (
            <section className="panel px-5 py-4">
              <h2 className="eyebrow">In the roundtable</h2>
              <p className="mt-2 text-sm text-ink">“{said.quote}”</p>
              <ul className="mt-3 flex flex-col gap-1.5">
                {scores.map((s) => (
                  <li key={s.category} className="text-xs">
                    <div className="flex justify-between"><span>{s.category}</span><b>{s.score}</b></div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-track"><div className={`h-1.5 rounded-full ${band(s.score) === 'willing' ? 'bg-brand' : band(s.score) === 'depends' ? 'bg-[var(--color-highlight)]' : 'bg-pending'}`} style={{ width: `${s.score}%` }} /></div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <section aria-labelledby="interview" className="panel flex min-w-0 flex-col">
          <div className="panel-head">
            <h2 id="interview" className="font-sans text-sm font-semibold text-ink">Interview</h2>
            <span className="text-xs text-ink-subtle">Answers are simulated from the data and say when they go beyond it.</span>
          </div>
          <ol className="flex flex-col gap-4 px-4 py-4" aria-live="polite">
            {chats.length === 0 && <li className="text-sm text-ink-muted">No questions yet. Ask about buying preferences, brands, channels or what would make them try something new.</li>}
            {chats.map((c) => {
              const a = (c.answer ?? {}) as { answer?: string; beyondData?: boolean; statIds?: string[]; isMock?: boolean };
              return (
                <li key={c.id} className="flex flex-col gap-2">
                  <p className="self-end rounded-full bg-brand-soft px-3 py-2 text-sm text-ink">{c.question}</p>
                  <div className="flex items-start gap-2">
                    <PersonaAvatar name={persona.name} profile={profile} size={32} />
                    <div className="min-w-0 rounded border border-line bg-surface px-3 py-2">
                      {c.ok ? <p className="whitespace-pre-line text-sm text-ink">{a.answer}</p> : <p className="text-sm text-warn">No answer was produced.</p>}
                      <p className="mt-1 text-[11px] text-ink-subtle">
                        {a.beyondData ? 'Goes beyond the data · ' : ''}
                        {a.statIds?.length ? `Draws on ${a.statIds.join(', ')}` : ''}
                        {a.isMock ? ' · mock' : ''}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-auto border-t border-line px-4 py-4">
            {canAsk ? <InterviewForm projectId={projectId} personaId={personaId} /> : <p className="text-sm text-ink-muted">Interviews are switched off for this project, or need the simulation.run permission.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
