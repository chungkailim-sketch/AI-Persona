import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { latestBrief, latestCast, studyBriefMissing } from '@/roundtable/service';
import type { CastProfile } from '@/roundtable/engine';
import { TIER_LABELS } from '@/server/castBuilder';
import { PersonaCard } from '@/ui/report/PersonaCard';
import { WorkflowNav } from '../WorkflowNav';
import { RefreshWhileImporting } from '../data/RefreshWhileImporting';
import { ApproveCastButton, BuildCastButton, RenamePersona } from './CastControls';

export const metadata = { title: 'Cast · RF AI Persona Intelligence' };
export const dynamic = 'force-dynamic';

/**
 * Step 3 — the cast: every chosen market × three income tiers, as a grid. Cohort lists, debates
 * and population samples are in the Advanced persona tools.
 */
export default async function CastStepPage(props: PageProps<'/projects/[projectId]/personas'>) {
  const { projectId } = await props.params;
  const user = await requireUser(`/projects/${projectId}/personas`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) notFound();

  const [brief, cast] = await Promise.all([latestBrief(projectId), latestCast(projectId)]);
  const missing = studyBriefMissing(brief);
  const canBuild = can(ctx, 'persona.create', projectId);
  const canApprove = can(ctx, 'persona.approve', projectId);
  const canEdit = can(ctx, 'persona.edit', projectId);
  const building = cast?.buildStatus === 'QUEUED' || cast?.buildStatus === 'RUNNING';
  const people = (cast?.personas ?? []).map((p) => ({ id: p.id, name: p.name, approval: p.versions[0]?.approval, profile: p.versions[0]?.profile as unknown as CastProfile | null }));
  const named = people.filter((p) => p.profile?.identity).length;
  const approved = people.length > 0 && people.every((p) => p.approval === 'APPROVED');
  const markets = [...new Set(people.map((p) => p.profile?.market).filter((m): m is string => Boolean(m)))];
  const tierLabel = (tier: number) => people.find((p) => p.profile?.tier === tier)?.profile?.tierLabel ?? TIER_LABELS[tier - 1];
  const planned = (brief?.markets.length ?? 0) * 3;

  return (
    <div className="flex flex-col gap-6">
      <WorkflowNav projectId={projectId} projectName={project.name} current="PERSONAS" />
      <RefreshWhileImporting active={building} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Cast</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            Three personas per market — one for each household-income tier — each described by the statistics where its tier differs most from the market.
          </p>
        </div>
        <Link href={`/projects/${projectId}/advanced/personas` as Route} className="text-sm text-link underline-offset-2 hover:underline">
          Advanced persona tools →
        </Link>
      </header>

      {!cast && (
        <section className="panel max-w-2xl px-5 py-5">
          {missing.length > 0 ? (
            <>
              <p className="text-sm text-ink">Complete the brief first:</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-muted">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
              <Link href={`/projects/${projectId}/brief` as Route} className="mt-3 inline-block text-sm text-link underline">Go to the brief</Link>
            </>
          ) : (
            <>
              <p className="text-sm text-ink">
                {`${planned} personas:`} {brief!.markets.join(', ')} {'× 3 income tiers.'}
              </p>
              <p className="mt-1 text-xs text-ink-subtle">One short model call per persona writes its illustrative identity. Takes a minute or two.</p>
              <div className="mt-4">{canBuild ? <BuildCastButton projectId={projectId} label="Build the cast" /> : <p className="text-sm text-ink-muted">Building a cast needs the persona.create permission.</p>}</div>
            </>
          )}
        </section>
      )}

      {cast && building && (
        <section className="panel max-w-2xl px-5 py-4" aria-live="polite">
          <p className="text-sm font-semibold text-ink">Building the cast…</p>
          <p className="mt-1 text-sm text-ink-muted">{people.length === 0 ? 'Reading the survey tables.' : `${named} of ${people.length} personas written.`}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-track">
            <div className="motion-progress h-full bg-brand-mark" style={{ width: `${people.length ? Math.round((named / people.length) * 100) : 5}%` }} />
          </div>
        </section>
      )}

      {cast?.buildStatus === 'FAILED' && (
        <section className="panel max-w-2xl px-5 py-4">
          <p role="alert" className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{cast.buildError ?? 'The cast could not be built.'}</p>
          {canBuild && <div className="mt-3"><BuildCastButton projectId={projectId} label="Try again" /></div>}
        </section>
      )}

      {cast && !building && people.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {approved ? (
              <span className="rounded-sm border border-ok/40 bg-ok-soft px-2 py-1 text-sm font-medium text-ok">Approved</span>
            ) : canApprove ? (
              <ApproveCastButton projectId={projectId} cohortId={cast.id} />
            ) : null}
            {canBuild && <BuildCastButton projectId={projectId} label="Rebuild cast" variant="secondary" />}
            {cast.generationNote && <p className="w-full max-w-prose text-xs text-ink-subtle">{cast.generationNote}</p>}
          </div>

          <section aria-label="Cast grid" className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-2">
              <thead>
                <tr>
                  <th scope="col" className="w-28" />
                  {markets.map((m) => (
                    <th key={m} scope="col" className="rounded-sm bg-brand-deep px-2 py-2 text-left text-sm font-bold text-brand-deep-ink">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3].map((tier) => (
                  <tr key={tier}>
                    <th scope="row" className="align-top text-left">
                      <span className="block text-xs font-bold uppercase tracking-wide text-brand">Tier {tier}</span>
                      <span className="block text-sm font-semibold text-ink">{tierLabel(tier)}</span>
                    </th>
                    {markets.map((m) => {
                      const p = people.find((x) => x.profile?.market === m && x.profile?.tier === tier);
                      return (
                        <td key={m} className="align-top">
                          {p?.profile ? (
                            <PersonaCard
                              name={p.name}
                              profile={p.profile}
                              portraitUrl={null}
                              footer={canEdit && !approved ? <RenamePersona projectId={projectId} personaId={p.id} name={p.name} /> : undefined}
                            />
                          ) : (
                            <p className="rounded border border-dashed border-line p-3 text-xs text-ink-subtle">No tier published.</p>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {approved && (
            <div className="flex justify-end">
              <Link href={`/projects/${projectId}/simulate` as Route} className="rounded bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
                Next: Roundtable →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
