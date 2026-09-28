import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { listCohorts } from '@/server/personas';
import { assessUsability } from '@/ingest/pipeline';
import { WorkflowNav } from '../WorkflowNav';
import { CohortDashboard } from './CohortDashboard';
import { AdherencePanel, CohortFromPopulationForm, PopulationForm, type AdherenceView, type PopulationSourceView } from './PopulationPanel';
import { latestAdherence } from '@/run/adherenceService';
import { latestPopulationSample } from '@/population/service';
import { readRecentEvents } from '@/telemetry/read';
import type { TelemetryEvent } from '@/telemetry/contract';
import { getDebate, listDebates } from '@/debate/service';
import { DebateDetail, DebateForm, type DebateView } from './DebatePanel';
import { MarketFilter } from './MarketFilter';
import {
  ApproveCohortForm,
  GenerateCohortForm,
  OriginKey,
  PersonaCard,
  type PersonaRow,
} from './PersonaStep';
import { fmtDate, fmtDateTime, TZ_LABEL } from '@/lib/time';

export const metadata = { title: 'Personas · Persona Intelligence' };
export const dynamic = 'force-dynamic';

export default async function PersonaStepPage(props: PageProps<'/projects/[projectId]/personas'>) {
  const { projectId } = await props.params;
  const search = await props.searchParams;
  const user = await requireUser(`/projects/${projectId}/personas`);

  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const canCreate = can(ctx, 'persona.create', projectId);
  const canApprove = can(ctx, 'persona.approve', projectId);
  const canDebate = can(ctx, 'simulation.run', projectId);

  const [links, cohorts, brief] = await Promise.all([
    prisma.projectDataset.findMany({
      where: { projectId, dataset: { deletedAt: null } },
      include: { dataset: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } } },
    }),
    listCohorts(user, projectId),
    prisma.brief.findFirst({ where: { projectId }, orderBy: { versionNo: 'desc' } }),
  ]);

  const datasets = await Promise.all(
    links
      .map((l) => ({ name: l.dataset.name, version: l.dataset.versions[0] }))
      .filter((d): d is { name: string; version: NonNullable<typeof d.version> } => Boolean(d.version))
      .map(async (d) => {
        const verdict = await assessUsability(d.version.id);
        return {
          id: d.version.id,
          label: `${d.name} (v${d.version.versionNo}, ${d.version.rowCount ?? 0} rows)`,
          usable: verdict.usable,
          blockers: verdict.blockers,
        };
      }),
  );

  const popSources: PopulationSourceView[] = await Promise.all(
    datasets.map(async (d) => {
      const fields = await prisma.datasetField.findMany({ where: { datasetVersionId: d.id }, select: { name: true, profile: true } });
      const names = new Set(fields.map((f) => f.name.trim().toLowerCase()));
      const long = ['wave_year', 'wave_month', 'statement', 'response', 'segment', 'share'].every((c) => names.has(c));
      const sg = fields.find((f) => f.name.trim().toLowerCase() === 'segment_group')?.profile as { withheld?: true; topValues?: { value: string }[] } | null | undefined;
      return { id: d.id, label: d.label, usable: d.usable && long, groups: sg?.withheld ? [] : (sg?.topValues ?? []).map((v) => v.value) };
    }),
  );
  const population = await latestPopulationSample(user, projectId);
  const adherence = await latestAdherence(cohorts.filter((c) => c.populationSampleId).map((c) => c.id));
  const adherenceView = (id: string): AdherenceView | null => {
    const a = adherence.get(id);
    if (!a) return null;
    return {
      verdict: a.verdict,
      when: fmtDateTime(a.createdAt),
      model: a.model,
      statement: a.detail.statement,
      reason: a.detail.reason,
      withTrait: a.detail.withTrait,
      withoutTrait: a.detail.withoutTrait,
    };
  };
  const popSpec = (population?.spec ?? null) as { wave?: string; members?: number; rejectedDraws?: number; removedCells?: string[]; segments?: { primary: string[]; secondary: string[] }; statements?: string[] } | null;
  const popQuotas = (population?.quotas ?? []) as { cell: string; weight: number; members: number }[];
  const popCal = (population?.calibration ?? []) as { dimension: string; maxAbsErrorPp: number; worstValue: string }[];
  const popExamples = (population?.examples ?? []) as { id: string; text: string }[];

  // ── Swarm debate ──
  const debates = await listDebates(user, projectId);
  const requestedDebate = typeof search.debate === 'string' ? search.debate : debates[0]?.id;
  const debateRow = requestedDebate ? await getDebate(user, projectId, requestedDebate) : null;
  const debateView: DebateView | null = debateRow
    ? {
        id: debateRow.id,
        topic: debateRow.topic,
        hypothesis: debateRow.hypothesis,
        status: debateRow.status,
        phase: debateRow.phase,
        isMock: debateRow.isMock,
        rounds: debateRow.rounds,
        seed: debateRow.seed,
        cohortName: debateRow.cohort.name,
        createdAt: debateRow.createdAt.toISOString(),
        completedAt: debateRow.completedAt?.toISOString() ?? null,
        spendUsd: debateRow.spendUsd,
        failureReason: debateRow.failureReason,
        agents: (debateRow.agents ?? []) as unknown as DebateView['agents'],
        evidence: (debateRow.evidence ?? null) as unknown as DebateView['evidence'],
        metrics: (debateRow.metrics ?? null) as unknown as DebateView['metrics'],
        conclusion: (debateRow.conclusion ?? null) as unknown as DebateView['conclusion'],
        turns: debateRow.turns.map((t) => ({
          seq: t.seq,
          round: t.round,
          phase: t.phase,
          agentKey: t.agentKey,
          agentName: t.agentName,
          agentRole: t.agentRole,
          stance: t.stance,
          confidence: t.confidence,
          addressedTo: t.addressedTo,
          content: t.content as Record<string, unknown>,
          ok: t.ok,
        })),
      }
    : null;
  const debateCohorts = cohorts
    .map((c) => ({ id: c.id, name: c.name, approved: c.personas.filter((p) => p.versions[0]?.approval === 'APPROVED').length }))
    .filter((c) => c.approved >= 2);
  const [completedRuns, hypotheses] = await Promise.all([
    prisma.run.findMany({
      where: { projectId, status: { in: ['COMPLETED', 'COMPLETED_WITH_WARNINGS'] }, synthesis: { isNot: null } },
      orderBy: { completedAt: 'desc' },
      take: 5,
      select: { id: true, completedAt: true, isMock: true },
    }),
    brief ? prisma.hypothesis.findMany({ where: { briefId: brief.id }, select: { statement: true } }) : Promise.resolve([]),
  ]);

  // ── Markets: from each persona's market attribute (survey cohorts) or its segment label. ──
  const marketOf = (attrs: { key: string; value: string }[], segment: string | null): string | null => {
    const a = attrs.find((x) => x.key.toLowerCase() === 'market');
    if (a) return a.value.replace(/^most common across the sample:\s*/i, '').split(',')[0]!.trim();
    return segment?.includes(' · ') ? segment.split(' · ')[0]! : null;
  };
  const cohortMarkets = new Map(
    cohorts.map((c) => [
      c.id,
      [...new Set(c.personas.map((p) => marketOf(p.versions[0]?.attributes ?? [], p.versions[0]?.segment ?? null)).filter((m): m is string => Boolean(m)))].sort(),
    ]),
  );
  const allMarkets = [...new Set([...cohortMarkets.values()].flat())].sort();
  const marketFilter = typeof search.market === 'string' && allMarkets.includes(search.market) ? search.market : '';
  const shownCohorts = marketFilter ? cohorts.filter((c) => cohortMarkets.get(c.id)!.includes(marketFilter)) : cohorts;
  const readyPersonas = shownCohorts.flatMap((c) =>
    c.personas
      .filter((p) => p.versions[0]?.approval === 'APPROVED')
      .map((p) => ({
        id: p.id,
        name: p.name,
        cohort: c.name,
        market: marketOf(p.versions[0]!.attributes, p.versions[0]!.segment),
        segment: p.versions[0]!.segment,
        base: p.versions[0]!.baseSize,
        confidence: p.versions[0]!.confidence,
        grounded: p.versions[0]!.attributes.filter((a) => a.origin === 'OBSERVED' || a.origin === 'DERIVED').length,
      }))
      .filter((p) => !marketFilter || p.market === marketFilter),
  );

  const cohortEvents = new Map<string, TelemetryEvent[]>();
  for (const c of cohorts.slice(0, 3)) {
    cohortEvents.set(c.id, await readRecentEvents({ projectId, cohortId: c.id }, 300));
  }

  return (
    <div className="flex flex-col gap-2">
      <WorkflowNav projectId={projectId} projectName={project.name} current="PERSONAS" />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">Personas</h1>
        {allMarkets.length > 0 && <MarketFilter markets={allMarkets} current={marketFilter} />}
      </div>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        A persona here is a summary of a segment in your data, not an invented character. Every
        attribute says where it came from, and the difference matters: an attribute that was
        measured supports a claim, and one that was generated does not.
      </p>

      <section aria-labelledby="key" className="mt-8">
        <h2 id="key" className="text-lg">What the labels mean</h2>
        <OriginKey />
      </section>

      <section aria-labelledby="ready" className="mt-8">
        <h2 id="ready" className="text-lg">
          Personas ready for simulation{marketFilter ? ` — ${marketFilter}` : ''}{' '}
          <span className="font-mono text-base text-ink-muted">{readyPersonas.length}</span>
        </h2>
        {readyPersonas.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No approved personas{marketFilter ? ` in ${marketFilter}` : ''} yet. Generate a cohort below and approve it.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-ink-subtle">
                <tr>
                  <th className="py-1 pr-3 font-normal">Persona</th>
                  <th className="py-1 pr-3 font-normal">Market</th>
                  <th className="py-1 pr-3 font-normal">Segment</th>
                  <th className="py-1 pr-3 font-normal">Base</th>
                  <th className="py-1 pr-3 font-normal">Confidence</th>
                  <th className="py-1 pr-3 font-normal">Grounded attributes</th>
                  <th className="py-1 font-normal">Cohort</th>
                </tr>
              </thead>
              <tbody>
                {readyPersonas.map((p) => (
                  <tr key={p.id} className="border-t border-line align-top">
                    <td className="max-w-[28rem] py-1.5 pr-3 text-ink">{p.name}</td>
                    <td className="py-1.5 pr-3 text-ink-muted">{p.market ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-ink-muted">{p.segment?.split(' · ').pop() ?? '—'}</td>
                    <td className="py-1.5 pr-3 font-mono">{p.base ?? '—'}</td>
                    <td className="py-1.5 pr-3 font-mono">{p.confidence.toLowerCase()}</td>
                    <td className="py-1.5 pr-3 font-mono">{p.grounded}</td>
                    <td className="py-1.5 text-ink-muted">{p.cohort}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {shownCohorts.length === 0 ? (
        <p className="panel mt-6 px-4 py-6 text-sm text-ink-muted">
          No cohort has been generated yet.
        </p>
      ) : (
        shownCohorts.map((cohort) => {
          const personas: PersonaRow[] = cohort.personas.map((p) => {
            const v = p.versions[0];
            return {
              id: p.id,
              name: p.name,
              summary: v?.summary ?? null,
              segment: v?.segment ?? null,
              weight: v?.weight ?? 0,
              baseSize: v?.baseSize ?? null,
              confidence: v?.confidence ?? 'LOW',
              coverageNote: v?.coverageNote ?? null,
              approval: v?.approval ?? 'DRAFT',
              attributes: (v?.attributes ?? []).map((a) => ({
                id: a.id,
                group: a.group,
                label: a.label,
                value: a.value,
                origin: a.origin,
                confidence: a.confidence,
                baseSize: a.baseSize,
              })),
            };
          });
          const approved = personas.length > 0 && personas.every((p) => p.approval === 'APPROVED');
          const statPersonas = cohort.personas.map((p) => {
            const v = p.versions[0];
            return {
              name: p.name,
              segment: v?.segment ?? null,
              baseSize: v?.baseSize ?? null,
              weight: v?.weight ?? 0,
              confidence: v?.confidence ?? 'LOW',
              approval: v?.approval ?? 'DRAFT',
              contradictions: v?.contradictions.length ?? 0,
              attributes: (v?.attributes ?? []).map((a) => ({ origin: a.origin, group: a.group })),
            };
          });
          const segmentField =
            cohort.personas[0]?.versions[0]?.attributes.find((a) => a.group === 'segment')?.label ?? null;

          return (
            <section
              key={cohort.id}
              aria-labelledby={`cohort-${cohort.id}`}
              className="mt-10 border-t border-line pt-8"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 id={`cohort-${cohort.id}`} className="text-lg">
                  {cohort.name}
                </h2>
                <p className="font-mono text-xs text-ink-subtle">
                  {personas.length} personas · generated{' '}
                  {fmtDate(cohort.generatedAt)}
                </p>
              </div>

              {cohort.generationNote && (
                <p className="mt-2 max-w-prose rounded border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
                  {cohort.generationNote}
                </p>
              )}

              <div className="mt-4">
                <CohortDashboard personas={statPersonas} segmentField={segmentField} events={cohortEvents.get(cohort.id) ?? []} />
              </div>

              <h3 className="mt-6 font-sans text-sm font-medium text-ink">Personas</h3>
              <ul className="mt-2 grid gap-3 xl:grid-cols-2">
                {personas.map((p) => (
                  <PersonaCard key={p.id} persona={p} />
                ))}
              </ul>

              {cohort.populationSampleId && (
                <AdherencePanel projectId={projectId} cohortId={cohort.id} latest={adherenceView(cohort.id)} canRun={canCreate} />
              )}

              {canApprove && (
                <ApproveCohortForm
                  projectId={projectId}
                  cohortId={cohort.id}
                  alreadyApproved={approved}
                />
              )}
            </section>
          );
        })
      )}

      <section aria-labelledby="debate-heading" id="debate" className="mt-12 scroll-mt-48 border-t border-line pt-8">
        <h2 id="debate-heading" className="text-lg">Agent swarm debate</h2>
        <p className="mt-1 max-w-prose text-xs text-ink-subtle">
          Put a topic or hypothesis to a crew of agents: one per approved persona, plus a moderator who manages the debate and
          hands the floor to named agents, an evidence analyst, a devil&rsquo;s advocate and a synthesis judge. Openings are
          given in isolation, every claim cites the cleared data by id, and the judge&rsquo;s reference conclusion sits beside a
          segment comparison computed in code. The agents are simulations of published segments; their agreement is not
          evidence.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div className="panel px-3.5 py-3">
              {!canDebate ? (
                <p className="text-sm text-ink-muted">Running a debate needs the <span className="font-mono">simulation.run</span> permission.</p>
              ) : debateCohorts.length === 0 ? (
                <p className="text-sm text-ink-muted">Approve a cohort with at least two personas first. The debate runs on approved personas only.</p>
              ) : (
                <DebateForm
                  projectId={projectId}
                  cohorts={debateCohorts}
                  runs={completedRuns.map((r) => ({ id: r.id, label: `Run ${r.id.slice(-8)} · ${r.completedAt ? fmtDate(r.completedAt) : ''}${r.isMock ? ' · mock' : ''}` }))}
                  hypotheses={hypotheses.map((h) => h.statement)}
                />
              )}
            </div>
            {debates.length > 0 && (
              <nav aria-label="Recent debates" className="panel">
                <div className="panel-head"><h3 className="font-sans text-sm font-medium text-ink">Recent debates</h3></div>
                <ul className="flex flex-col divide-y divide-line">
                  {debates.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/projects/${projectId}/personas?debate=${d.id}#debate`}
                        aria-current={d.id === debateView?.id ? 'true' : undefined}
                        className={`block px-3.5 py-2 hover:bg-bg ${d.id === debateView?.id ? 'border-l-2 border-brand bg-brand-soft/40' : 'border-l-2 border-transparent'}`}
                      >
                        <span className="line-clamp-2 text-xs text-ink">{d.topic}</span>
                        <span className="mt-0.5 block font-mono text-[10px] text-ink-subtle">
                          {d.status.toLowerCase()} · {d.cohort.name} · {fmtDateTime(d.createdAt)}{d.isMock ? ' · mock' : ''}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>
          <div className="min-w-0">
            {debateView ? (
              <DebateDetail debate={debateView} />
            ) : (
              <p className="rounded border border-line bg-surface px-4 py-3 text-sm text-ink-muted">No debate yet. Enter a topic and run one.</p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="population" className="mt-12 border-t border-line pt-8">
        <h2 id="population" className="text-lg">Population sample</h2>
        <p className="mt-1 max-w-prose text-xs text-ink-subtle">
          A seeded, quota-controlled population drawn from the cleared data&rsquo;s latest wave: cells sized by
          largest-remainder quotas on the published bases, impossible combinations removed, and each member&rsquo;s
          answers drawn from its segment&rsquo;s observed distribution. It shows what the segment shares imply at
          scale and how closely a sample reproduces them. Every member is simulated; none is a respondent.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="panel px-3.5 py-3">
            {canCreate ? <PopulationForm projectId={projectId} sources={popSources} /> : <p className="text-sm text-ink-muted">Building a sample needs the <span className="font-mono">persona.create</span> permission.</p>}
          </div>
          <div className="min-w-0">
            {population && popSpec ? (
              <div className="flex flex-col gap-4">
                <p className="font-mono text-[11px] text-ink-subtle">
                  {popSources.find((x) => x.id === population.datasetVersionId)?.label ?? 'Dataset'} · {population.size.toLocaleString()} members · seed {population.seed} · {population.primaryGroup}{population.secondaryGroup ? ` × ${population.secondaryGroup}` : ''} · {popSpec.wave} · built {fmtDateTime(population.createdAt)} {TZ_LABEL} · {popSpec.rejectedDraws ?? 0} redraws
                </p>
                {canCreate && (
                  <CohortFromPopulationForm projectId={projectId} sampleId={population.id} cells={popQuotas.filter((q) => q.members > 0).length} defaultCount={Math.min(12, popQuotas.filter((q) => q.members > 0).length)} />
                )}
                <div>
                  <h3 className="text-sm font-medium text-ink">Calibration — sampled against target, worst category per dimension</h3>
                  <p className="text-xs text-ink-subtle">Sampling error alone is about {Math.round(100 / Math.sqrt(population.size) * 10) / 10} pp at this size; a larger gap would mean the sampler, not chance.</p>
                  <table className="mt-2 w-full text-left text-xs">
                    <thead className="text-ink-subtle"><tr><th className="py-1 pr-3 font-normal">Dimension</th><th className="py-1 pr-3 font-normal">Max error (pp)</th><th className="py-1 font-normal">Worst category</th></tr></thead>
                    <tbody>
                      {popCal.map((c) => (
                        <tr key={c.dimension} className="border-t border-line">
                          <td className="max-w-[28rem] py-1 pr-3 text-ink">{c.dimension}</td>
                          <td className="py-1 pr-3 font-mono text-ink">{c.maxAbsErrorPp.toFixed(2)}</td>
                          <td className="py-1 text-ink-muted">{c.worstValue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details>
                  <summary className="cursor-pointer text-xs text-brand">Quotas for {popQuotas.length} cells{(popSpec.removedCells?.length ?? 0) > 0 ? ` (${popSpec.removedCells!.length} removed as impossible)` : ''}</summary>
                  <table className="mt-2 w-full text-left text-xs">
                    <thead className="text-ink-subtle"><tr><th className="py-1 pr-3 font-normal">Cell</th><th className="py-1 pr-3 font-normal">Weight</th><th className="py-1 font-normal">Members</th></tr></thead>
                    <tbody className="font-mono">
                      {popQuotas.map((q) => (
                        <tr key={q.cell} className="border-t border-line"><td className="py-1 pr-3 font-sans text-ink">{q.cell}</td><td className="py-1 pr-3 text-ink-muted">{(q.weight * 100).toFixed(2)}%</td><td className="py-1 text-ink">{q.members}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  {(popSpec.removedCells?.length ?? 0) > 0 && <p className="mt-1 text-[11px] text-ink-subtle">Removed: {popSpec.removedCells!.join('; ')}</p>}
                </details>
                <details>
                  <summary className="cursor-pointer text-xs text-brand">Example members (rendered as a persona prompt would see them)</summary>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {popExamples.map((e) => (
                      <pre key={e.id} className="overflow-x-auto whitespace-pre-wrap rounded border border-line bg-code p-2 font-mono text-[10.5px] text-ink"><span className="text-simulated">SIMULATED · {e.id}</span>{'\n'}{e.text}</pre>
                    ))}
                  </div>
                </details>
                <div>
                  <h3 className="text-sm font-medium text-ink">Assumptions</h3>
                  <ul className="mt-1 flex flex-col gap-1">
                    {population.assumptions.map((a) => (
                      <li key={a} className="flex gap-2 text-xs text-ink-muted"><span aria-hidden className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-warn" /><span>{a}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="rounded border border-line bg-surface px-4 py-3 text-sm text-ink-muted">No population sample yet.</p>
            )}
          </div>
        </div>
      </section>

      {canCreate && (
        <section aria-labelledby="generate" className="mt-12 border-t border-line pt-8">
          <h2 id="generate" className="text-lg">Generate a cohort</h2>
          <p className="mt-1 max-w-prose text-xs text-ink-subtle">
            Only a dataset that has been cleared in step 1 can be used. Generation is deterministic:
            the same data and the same seed produce the same cohort, so two runs remain comparable.
          </p>
          <GenerateCohortForm
            projectId={projectId}
            datasets={datasets}
            defaultCount={brief?.personaCount ?? 12}
          />
        </section>
      )}

      {!canCreate && (
        <p className="mt-10 max-w-prose rounded border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          You can read this cohort but not change it.
        </p>
      )}

      <p className="mt-10 text-sm text-ink-muted">
        Next:{' '}
        <Link
          href={`/projects/${projectId}/simulate`}
          className="text-brand underline-offset-2 hover:underline"
        >
          configure the simulation
        </Link>
        .
      </p>
    </div>
  );
}
