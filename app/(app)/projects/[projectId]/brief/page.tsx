import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { getOrCreateBrief, assessBrief, DESIRED_OUTCOME_NOTICE } from '@/server/brief';
import { WorkflowNav } from '../WorkflowNav';
import { latestStimulusChecks } from '@/judge/checks';
import {
  AddHypothesisForm,
  AddStimulusForm,
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
  const stimulusChecks = await latestStimulusChecks(brief.stimuli.map((s) => s.id));

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

      {/* ── Stimuli ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="stimuli" className="mt-12 border-t border-line pt-8">
        <h2 id="stimuli" className="text-lg">Stimulus material</h2>
        <p className="mt-1 max-w-prose text-xs text-ink-subtle">
          Optional. Concepts, messages or copy for personas to react to. Treated as untrusted
          content throughout: text inside a stimulus that reads like an instruction is data, and is
          never followed.
        </p>
        {brief.stimuli.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {brief.stimuli.map((s) => (
              <li key={s.id} className="rounded border border-line bg-surface px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-bg px-2 py-0.5 font-mono text-[10px] uppercase text-ink-muted">
                    {s.label}
                  </span>
                  <span className="text-sm font-medium text-ink">{s.name}</span>
                  <span className="font-mono text-[10px] text-ink-subtle">
                    {s.content.length.toLocaleString()} characters
                  </span>
                  {stimulusChecks.get(s.id)?.flagged && (
                    <span className="rounded-sm border border-warn/40 bg-warn-soft px-1.5 font-mono text-[10px] text-warn">
                      possible instruction to evaluators
                    </span>
                  )}
                </div>
                {stimulusChecks.get(s.id)?.flagged && (
                  <p className="mt-2 rounded border border-warn/40 bg-warn-soft/50 px-2 py-1.5 text-xs text-ink">
                    The judge-model screen reads part of this stimulus as addressed to an AI or evaluator
                    (probability {stimulusChecks.get(s.id)!.confidence?.toFixed(2)}). It is still treated as data and never
                    followed, but a real respondent would not see such text — remove it unless it is part of what is being tested.
                  </p>
                )}
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-ink-subtle">
                  {s.content.slice(0, 400)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canEdit && <AddStimulusForm projectId={projectId} briefId={brief.id} />}
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
