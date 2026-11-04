import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { availableMarkets, latestBrief, latestCast } from '@/roundtable/service';
import { proposeParameters } from '@/roundtable/parameters';
import type { CastProfile } from '@/roundtable/engine';
import { getDebate, listDebates } from '@/debate/service';
import { fmtDateTime } from '@/lib/time';
import { PersonaCard } from '@/ui/report/PersonaCard';
import { WorkflowNav } from '../WorkflowNav';
import { DecisionGuidance } from '../DecisionGuidance';
import { RefreshWhileImporting } from '../data/RefreshWhileImporting';
import { ApproveCastButton, BuildPersonasForm, RenamePersona } from './CastControls';
import { DebateDetail, DebateForm } from './DebatePanel';
import { toDebateView } from './debateView';
import { projectModules } from '@/modules/project';

export const metadata = { title: 'Personas · RF AI Persona Intelligence' };
export const dynamic = 'force-dynamic';

/**
 * Step 3 — personas built from every file uploaded in step 1, on the markets and parameters the user
 * chooses; each card opens the persona for an interview. The agent-swarm debate runs on them here.
 * Cohort lists and population samples are in the Advanced persona tools.
 */
export default async function PersonasStepPage(props: PageProps<'/projects/[projectId]/personas'>) {
  const { projectId } = await props.params;
  const search = await props.searchParams;
  const user = await requireUser(`/projects/${projectId}/personas`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) notFound();

  const [brief, cast, markets, parameters, fileCount] = await Promise.all([
    latestBrief(projectId),
    latestCast(projectId),
    availableMarkets(projectId),
    proposeParameters(projectId),
    prisma.projectDataset.count({ where: { projectId, dataset: { deletedAt: null } } }),
  ]);
  const modules = await projectModules(projectId);
  const canBuild = can(ctx, 'persona.create', projectId);
  const canApprove = can(ctx, 'persona.approve', projectId);
  const canEdit = can(ctx, 'persona.edit', projectId);
  const canDebate = can(ctx, 'simulation.run', projectId);
  const building = cast?.buildStatus === 'QUEUED' || cast?.buildStatus === 'RUNNING';
  const people = (cast?.personas ?? []).map((p) => ({ id: p.id, name: p.name, approval: p.versions[0]?.approval, profile: p.versions[0]?.profile as unknown as CastProfile | null }));
  const named = people.filter((p) => p.profile?.identity).length;
  const approved = people.length > 0 && people.every((p) => p.approval === 'APPROVED');
  const nextStep = modules.has('roundtable') ? { href: 'simulate', label: 'Next: Roundtable →' } : { href: 'results', label: 'Next: Results →' };
  const castMarkets = [...new Set(people.map((p) => p.profile?.market).filter((m): m is string => Boolean(m)))];
  // Rows: one per parameter value (tier or segment), in the order the personas were built.
  const rows: { key: string; group: string; tier: number; label: string }[] = [];
  for (const p of people) {
    if (!p.profile) continue;
    const key = `${p.profile.group ?? ''}|${p.profile.tier}`;
    if (!rows.some((r) => r.key === key)) rows.push({ key, group: p.profile.group ?? '', tier: p.profile.tier, label: p.profile.tierLabel });
  }
  const params = (cast?.parameters ?? null) as { markets?: string[]; groups?: string[] } | null;
  const chosenMarkets = params?.markets ?? brief?.markets ?? [];
  const chosenParameters = params?.groups ?? parameters.filter((p) => p.recommended && p.kind === 'income').map((p) => p.name);

  // The swarm debate runs on the approved personas.
  const debates = (await listDebates(user, projectId)).filter((d) => d.cohortId === cast?.id).slice(0, 5);
  const requested = typeof search.debate === 'string' ? search.debate : debates[0]?.id;
  const debateRow = requested ? await getDebate(user, projectId, requested) : null;
  const debate = debateRow ? toDebateView(debateRow) : null;
  const debateRunning = debate?.status === 'QUEUED' || debate?.status === 'RUNNING';

  return (
    <div className="flex flex-col gap-6">
      <WorkflowNav projectId={projectId} projectName={project.name} current="PERSONAS" />
      <RefreshWhileImporting active={building || debateRunning} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Personas</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            Personas built from all the data uploaded in step 1, on the parameters you choose. Open a persona to interview it.
          </p>
        </div>
        <Link href={`/projects/${projectId}/advanced/personas` as Route} className="text-sm text-link underline-offset-2 hover:underline">
          Advanced persona tools →
        </Link>
      </header>

      {canBuild && !building && (
        <details className="panel" open={!cast}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">{cast ? 'Rebuild the personas on other markets or parameters' : 'Build the personas'}</summary>
          <div className="border-t border-line px-4 py-4">
            {markets.length === 0 ? (
              <p className="text-sm text-ink-muted">No market was found in the data yet. <Link href={`/projects/${projectId}/data` as Route} className="text-link underline">Upload data in step 1.</Link></p>
            ) : (
              <BuildPersonasForm
                projectId={projectId}
                markets={markets}
                chosenMarkets={chosenMarkets.filter((m) => markets.includes(m))}
                parameters={parameters}
                chosenParameters={chosenParameters.filter((g) => parameters.some((p) => p.name === g))}
                label={cast ? 'Rebuild personas' : 'Build personas'}
                fileCount={fileCount}
              />
            )}
          </div>
        </details>
      )}

      {cast && building && (
        <section className="panel max-w-2xl px-5 py-4" aria-live="polite">
          <p className="text-sm font-semibold text-ink">Building the personas…</p>
          <p className="mt-1 text-sm text-ink-muted">{people.length === 0 ? 'Reading the survey tables.' : `${named} of ${people.length} personas written.`}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-track">
            <div className="motion-progress h-full bg-brand-mark" style={{ width: `${people.length ? Math.round((named / people.length) * 100) : 5}%` }} />
          </div>
        </section>
      )}

      {cast?.buildStatus === 'FAILED' && (
        <p role="alert" className="max-w-2xl rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{cast.buildError ?? 'The personas could not be built.'}</p>
      )}

      {cast && !building && people.length > 0 && (
        <section aria-labelledby="personas-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="personas-heading" className="text-lg">{`${people.length} personas`}</h2>
            {approved ? (
              <span className="rounded-sm border border-ok/40 bg-ok-soft px-2 py-1 text-sm font-medium text-ok">Approved</span>
            ) : canApprove ? (
              <ApproveCastButton projectId={projectId} cohortId={cast.id} />
            ) : null}
            {cast.generationNote && <p className="w-full max-w-prose text-xs text-ink-subtle">{cast.generationNote}</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-2">
              <thead>
                <tr>
                  <th scope="col" className="w-32" />
                  {castMarkets.map((m) => (
                    <th key={m} scope="col" className="rounded-sm bg-brand-deep px-2 py-2 text-left text-sm font-bold text-brand-deep-ink">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row" className="align-top text-left">
                      <span className="block text-[11px] font-bold uppercase tracking-wide text-brand">{row.group}</span>
                      <span className="block text-sm font-semibold text-ink">{row.label}</span>
                    </th>
                    {castMarkets.map((m) => {
                      const p = people.find((x) => x.profile?.market === m && `${x.profile.group ?? ''}|${x.profile.tier}` === row.key);
                      return (
                        <td key={m} className="align-top">
                          {p?.profile ? (
                            <div className="flex h-full flex-col gap-1">
                              <Link href={`/projects/${projectId}/personas/${p.id}` as Route} className="block h-full rounded outline-offset-2 hover:ring-2 hover:ring-brand-mark" aria-label={`Open ${p.name}`}>
                                <PersonaCard name={p.name} profile={p.profile} portraitUrl={null} footer={modules.has('interviews') ? <span className="text-xs font-semibold text-link">Open and interview →</span> : undefined} />
                              </Link>
                              {canEdit && !approved && <RenamePersona projectId={projectId} personaId={p.id} name={p.name} />}
                            </div>
                          ) : (
                            <p className="rounded border border-dashed border-line p-3 text-xs text-ink-subtle">Not published for this market.</p>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DecisionGuidance projectId={projectId} checkpoint="CAST" subjectId={cast.id} canAsk={can(ctx, 'project.edit', projectId)} />
        </section>
      )}

      {modules.has('debate') && cast && !building && people.length > 0 && (
        <section aria-labelledby="debate-heading" id="debate" className="scroll-mt-48 border-t border-line pt-6">
          <h2 id="debate-heading" className="text-lg">Agent swarm debate</h2>
          <p className="mt-1 max-w-prose text-xs text-ink-subtle">
            Put a topic or hypothesis to these personas as a crew of agents, with a moderator, an evidence analyst, a devil&rsquo;s advocate and a judge. When it ends, the OpenAI Decisions API weighs the outcome and recommends what to do next.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              <div className="panel px-3.5 py-3">
                {!canDebate ? (
                  <p className="text-sm text-ink-muted">Running a debate needs the simulation.run permission.</p>
                ) : !approved ? (
                  <p className="text-sm text-ink-muted">Approve the personas first. The debate runs on approved personas only.</p>
                ) : (
                  <DebateForm projectId={projectId} cohorts={[{ id: cast.id, name: cast.name, approved: people.length }]} runs={[]} hypotheses={[]} returnTo="journey" />
                )}
              </div>
              {debates.length > 0 && (
                <nav aria-label="Recent debates" className="panel">
                  <div className="panel-head"><h3 className="font-sans text-sm font-medium text-ink">Recent debates</h3></div>
                  <ul className="flex flex-col divide-y divide-line">
                    {debates.map((d) => (
                      <li key={d.id}>
                        <Link
                          href={`/projects/${projectId}/personas?debate=${d.id}#debate` as Route}
                          aria-current={d.id === debate?.id ? 'true' : undefined}
                          className={`block px-3.5 py-2 hover:bg-bg ${d.id === debate?.id ? 'border-l-2 border-brand bg-brand-soft/40' : 'border-l-2 border-transparent'}`}
                        >
                          <span className="line-clamp-2 text-xs text-ink">{d.topic}</span>
                          <span className="mt-0.5 block text-[10.5px] text-ink-subtle">{`${d.status.toLowerCase()} · ${fmtDateTime(d.createdAt)}${d.isMock ? ' · mock' : ''}`}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {debate?.status === 'COMPLETED' && (
                <DecisionGuidance projectId={projectId} checkpoint="DEBATE" subjectId={debate.id} canAsk={can(ctx, 'project.edit', projectId)} title="Decision on the debate outcome" />
              )}
              {debate ? <DebateDetail debate={debate} /> : <p className="rounded border border-line bg-surface px-4 py-3 text-sm text-ink-muted">No debate yet. Enter a topic and run one.</p>}
            </div>
          </div>
        </section>
      )}

      {approved && (
        <div className="flex justify-end">
          <Link href={`/projects/${projectId}/${nextStep.href}` as Route} className="rounded bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
            {nextStep.label}
          </Link>
        </div>
      )}
    </div>
  );
}
