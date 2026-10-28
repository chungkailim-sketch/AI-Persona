import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { latestBrief, latestCast, latestRoundtable } from '@/roundtable/service';
import type { CastProfile } from '@/roundtable/engine';
import { band, BAND_LABEL } from '@/roundtable/marketIndex';
import { PersonaAvatar } from '@/ui/report/PersonaCard';
import { WorkflowNav } from '../WorkflowNav';
import { RefreshWhileImporting } from '../data/RefreshWhileImporting';
import { StartRoundtableButton } from './RoundtableControls';

export const metadata = { title: 'Roundtable · RF AI Persona Intelligence' };
export const dynamic = 'force-dynamic';

const BAND_CLS = { willing: 'border-ok/40 bg-ok-soft text-ok', depends: 'border-warn/40 bg-warn-soft text-warn', unlikely: 'border-line bg-pending-soft text-pending' } as const;

/** Step 4 — every persona of the approved cast answers the question alone. Hypothesis runs are in Advanced. */
export default async function RoundtableStepPage(props: PageProps<'/projects/[projectId]/simulate'>) {
  const { projectId } = await props.params;
  const user = await requireUser(`/projects/${projectId}/simulate`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) notFound();

  const [brief, cast, rt] = await Promise.all([latestBrief(projectId), latestCast(projectId), latestRoundtable(projectId)]);
  const canRun = can(ctx, 'simulation.run', projectId);
  const castReady = Boolean(cast && cast.buildStatus === 'COMPLETED' && cast.personas.length > 0 && cast.personas.every((p) => p.versions[0]?.approval === 'APPROVED'));
  const running = rt?.status === 'QUEUED' || rt?.status === 'RUNNING';
  const personas = new Map((cast?.personas ?? []).map((p) => [p.id, { name: p.name, profile: p.versions[0]?.profile as unknown as CastProfile | null }]));
  // Answers may belong to an earlier cast; read their names from the personas themselves.
  const answerPersonas = rt ? await prisma.persona.findMany({ where: { id: { in: rt.answers.map((a) => a.personaId) } }, select: { id: true, name: true } }) : [];
  for (const p of answerPersonas) if (!personas.has(p.id)) personas.set(p.id, { name: p.name, profile: null });
  const answers = [...(rt?.answers ?? [])].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const isMock = env().MODEL_PROVIDER === 'mock';
  const stale = rt && cast && rt.cohortId !== cast.id;

  return (
    <div className="flex flex-col gap-6">
      <WorkflowNav projectId={projectId} projectName={project.name} current="SIMULATION" />
      <RefreshWhileImporting active={running} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Roundtable</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">Every persona answers the question alone and scores each category from 0 to 100.</p>
        </div>
        <Link href={`/projects/${projectId}/advanced/simulate` as Route} className="text-sm text-link underline-offset-2 hover:underline">
          Advanced simulation tools →
        </Link>
      </header>

      <section className="panel max-w-3xl px-5 py-5">
        <p className="eyebrow">The question</p>
        <p className="mt-1 text-lg font-semibold text-ink">{rt?.question ?? brief?.researchQuestion ?? '—'}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {(rt?.categories ?? brief?.categories ?? []).map((c) => (
            <li key={c} className="rounded-sm border border-line bg-bg px-2 py-0.5 text-xs text-ink-muted">{c}</li>
          ))}
        </ul>
        {!rt || (!running && (rt.status === 'FAILED' || stale)) ? (
          <div className="mt-5 flex flex-col gap-2">
            {!castReady ? (
              <p className="text-sm text-ink-muted">
                Approve the cast first. <Link href={`/projects/${projectId}/personas` as Route} className="text-link underline">Go to the cast</Link>
              </p>
            ) : (
              <>
                <p className="text-sm text-ink">{`${cast!.personas.length} personas will answer, then a strategist writes the takeaways: ${cast!.personas.length + 1} model calls.`}</p>
                {isMock && <p className="text-xs text-warn">The mock model provider is configured: answers will be placeholders.</p>}
                {canRun ? <StartRoundtableButton projectId={projectId} label={rt ? 'Run the roundtable again' : 'Start the roundtable'} /> : <p className="text-sm text-ink-muted">Starting a roundtable needs the simulation.run permission.</p>}
              </>
            )}
          </div>
        ) : null}
        {stale && !running && <p className="mt-3 text-xs text-ink-subtle">The cast has been rebuilt since the last roundtable; run it again to use the new cast.</p>}
      </section>

      {rt && (
        <section className="panel max-w-3xl" aria-live="polite">
          <div className="panel-head">
            <h2 className="font-sans text-sm font-semibold text-ink">
              {running ? (rt.phase === 'SUMMARY' ? 'Writing the takeaways…' : 'Personas answering…') : rt.status === 'COMPLETED' ? 'Roundtable complete' : 'Roundtable stopped'}
            </h2>
            <span className="text-xs text-ink-subtle">{`${rt.answers.length} of ${rt.total} answered`}</span>
          </div>
          <div className="px-4 py-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-track">
              <div className="motion-progress h-full bg-brand-mark" style={{ width: `${rt.total ? Math.round((rt.answers.length / rt.total) * 100) : 0}%` }} />
            </div>
            {rt.failureReason && <p role="alert" className={`mt-3 rounded border px-3 py-2 text-sm ${rt.status === 'FAILED' ? 'border-danger bg-danger-soft text-danger' : 'border-warn bg-warn-soft text-warn'}`}>{rt.failureReason}</p>}
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {answers.slice(0, 8).map((a) => {
                const p = personas.get(a.personaId);
                const b = band(a.overall ?? 0);
                return (
                  <li key={a.id} className="flex gap-3 py-2.5">
                    <PersonaAvatar name={p?.name ?? '?'} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">
                        {p?.name ?? 'Persona'} <span className="font-normal text-ink-subtle">· {a.market} · Tier {a.tier}</span>
                      </p>
                      {a.ok ? <p className="text-sm text-ink-muted">“{a.quote}”</p> : <p className="text-sm text-warn">No usable answer.</p>}
                    </div>
                    {a.ok && <span className={`h-fit shrink-0 rounded-sm border px-2 py-0.5 text-xs font-medium ${BAND_CLS[b]}`}>{`${Math.round(a.overall ?? 0)} · ${BAND_LABEL[b]}`}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {rt?.status === 'COMPLETED' && (
        <div className="flex max-w-3xl justify-end">
          <Link href={`/projects/${projectId}/results` as Route} className="rounded bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
            Next: Report →
          </Link>
        </div>
      )}
    </div>
  );
}
