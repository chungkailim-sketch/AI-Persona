import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { getOrCreateBrief, assessBrief, DESIRED_OUTCOME_NOTICE } from '@/server/brief';
import { WorkflowNav } from '../WorkflowNav';
import {
  AddHypothesisForm,
  BriefForm,
  HypothesisList,
} from './BriefStep';

export const metadata = { title: 'Brief · Persona Intelligence' };
export const dynamic = 'force-dynamic';

export default async function BriefStepPage(props: PageProps<'/projects/[projectId]/brief'>) {
  const { projectId } = await props.params;
  const user = await requireUser(`/projects/${projectId}/brief`);

  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const canEdit = can(ctx, 'project.edit', projectId);
  const brief = await getOrCreateBrief(user, projectId);
  const readiness = await assessBrief(projectId);

  if (!brief) {
    return (
      <div className="">
        <WorkflowNav projectId={projectId} projectName={project.name} current="BRIEF" />
        <h1 className="mt-6 text-2xl">Brief</h1>
        <p className="mt-3 max-w-prose rounded border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          No brief has been written yet, and viewers cannot start one.
        </p>
      </div>
    );
  }

  const nextLabel = `H${brief.hypotheses.length + 1}`;
  return (
    <div className="">
      <WorkflowNav projectId={projectId} projectName={project.name} current="BRIEF" />

      <h1 className="mt-6 text-2xl">Brief</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        State the question, what would answer it, and what decision hangs on it. Two things here
        are deliberate rather than bureaucratic: each hypothesis has to say in advance what evidence
        would count as support, and what you are hoping to find is recorded for the report but kept
        out of the simulation.
      </p>

      {/* ── Readiness ────────────────────────────────────────────────────── */}
      <section aria-labelledby="readiness" className="mt-8">
        <h2 id="readiness" className="text-lg">Is this ready to run?</h2>
        {readiness.ready ? (
          <p className="mt-3 rounded border border-ok bg-ok-soft px-4 py-3 text-sm text-ok">
            Yes. The question, the decision, the markets and at least one hypothesis with a
            threshold are all stated.
          </p>
        ) : (
          <div className="mt-3 rounded border border-warn bg-warn-soft/40 px-4 py-3">
            <p className="text-sm font-medium text-ink">Not yet. Outstanding:</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {readiness.missing.map((m) => (
                <li key={m} className="flex gap-2 text-sm text-ink-muted">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-warn" />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── Brief detail ─────────────────────────────────────────────────── */}
      {canEdit ? (
        <section aria-labelledby="detail" className="mt-12 border-t border-line pt-8">
          <h2 id="detail" className="text-lg">The brief</h2>
          <BriefForm
            projectId={projectId}
            desiredOutcomeNotice={DESIRED_OUTCOME_NOTICE}
            defaults={{
              briefId: brief.id,
              businessContext: brief.businessContext ?? '',
              researchQuestion: brief.researchQuestion ?? '',
              objective: brief.objective ?? '',
              decisionSupported: brief.decisionSupported ?? '',
              targetAudience: brief.targetAudience ?? '',
              markets: brief.markets.join(', '),
              timePeriod: brief.timePeriod ?? '',
              competitors: brief.competitors.join(', '),
              desiredOutcome: brief.desiredOutcome ?? '',
              constraints: brief.constraints ?? '',
              exclusions: brief.exclusions.join(', '),
              prohibitedInferences: brief.prohibitedInferences.join(', '),
              personaCount: brief.personaCount,
              runCount: brief.runCount,
              simulationDepth: brief.simulationDepth,
              confidenceRequirement: brief.confidenceRequirement ?? '',
              reportAudience: brief.reportAudience ?? '',
              locked: brief.status === 'LOCKED',
            }}
          />
        </section>
      ) : (
        <p className="mt-10 max-w-prose rounded border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          You can read this brief but not change it.
        </p>
      )}

      {/* ── Hypotheses ───────────────────────────────────────────────────── */}
      <section aria-labelledby="hypotheses" className="mt-12 border-t border-line pt-8">
        <h2 id="hypotheses" className="text-lg">Hypotheses</h2>
        <p className="mt-1 max-w-prose text-xs text-ink-subtle">
          Each one carries the threshold you set before seeing any result. The threshold is shown in
          the report beside whatever the run found, so a reader can judge for themselves whether it
          was met.
        </p>
        <HypothesisList
          projectId={projectId}
          canEdit={canEdit}
          hypotheses={brief.hypotheses.map((h) => ({
            id: h.id,
            label: h.label,
            statement: h.statement,
            operationalDefinition: h.operationalDefinition,
            nullHypothesis: h.nullHypothesis,
            minimumEvidenceThreshold: h.minimumEvidenceThreshold,
            alternativeExplanations: h.alternativeExplanations,
          }))}
        />
        {canEdit && (
          <AddHypothesisForm projectId={projectId} briefId={brief.id} nextLabel={nextLabel} />
        )}
      </section>

      <p className="mt-10 text-sm text-ink-muted">
        Next:{' '}
        <Link
          href={`/projects/${projectId}/personas`}
          className="text-brand underline-offset-2 hover:underline"
        >
          generate the cohort
        </Link>
        .
      </p>
    </div>
  );
}
