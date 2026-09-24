'use client';

import { useActionState } from 'react';
import { planRunAction, confirmRunAction, type RunFormState } from '../runActions';
import { Field, FormMessages, Select, SubmitButton, TextInput } from '@/ui/forms';

const empty: RunFormState = {};

export function PlanRunForm({
  projectId,
  cohorts,
  blockers,
}: {
  projectId: string;
  cohorts: { id: string; name: string; approved: number }[];
  blockers: string[];
}) {
  const [state, action] = useActionState(planRunAction, empty);

  if (blockers.length > 0) {
    return (
      <div className="mt-4 max-w-prose rounded border border-warn bg-warn-soft/40 px-4 py-3">
        <p className="text-sm font-medium text-ink">Not yet. Outstanding:</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {blockers.map((b) => (
            <li key={b} className="flex gap-2 text-sm text-ink-muted">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-warn" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form action={action} className="mt-4 flex max-w-xl flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />

      <Field id="cohortId" label="Cohort" required>
        <Select id="cohortId" name="cohortId" required>
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.approved} approved)
            </option>
          ))}
        </Select>
      </Field>

      <Field
        id="run-seed"
        label="Seed"
        hint="Recorded in the plan hash. The same plan and seed produce the same sequence of requests."
      >
        <TextInput id="run-seed" name="seed" type="number" defaultValue={42} aria-describedby="run-seed-hint" />
      </Field>

      <FormMessages state={state} />
      <SubmitButton pendingLabel="Preparing…">Prepare a plan</SubmitButton>
    </form>
  );
}

export interface PlanSummary {
  runId: string;
  planHash: string;
  cohortName: string;
  personaCount: number;
  datasetCount: number;
  provider: string;
  modelId: string;
  estimatedCalls: number;
  estimatedCostUsd: number;
  budgetCapUsd: number;
  isMock: boolean;
}

/**
 * The confirmation gate.
 *
 * This is the last point before anything is spent. The estimate is shown in full, the plan hash is
 * carried in the form so the server can refuse a confirmation that no longer matches what was
 * displayed, and the mock case is stated outright rather than buried — someone confirming a run
 * they believe consults a model, when it does not, would read every number afterwards wrongly.
 */
export function ConfirmRunPanel({ projectId, plan }: { projectId: string; plan: PlanSummary }) {
  const [state, action] = useActionState(confirmRunAction, empty);

  return (
    <div className="mt-4 max-w-2xl rounded border border-brand bg-brand-soft/30 p-5">
      <h3 className="text-lg">Confirm before anything runs</h3>
      <p className="mt-1 max-w-prose text-sm text-ink-muted">
        Nothing has been sent anywhere yet. This is what will happen if you confirm.
      </p>

      <dl className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <div className="flex justify-between gap-4 border-b border-line pb-1">
          <dt className="text-sm text-ink-subtle">Cohort</dt>
          <dd className="text-sm text-ink">{plan.cohortName}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-line pb-1">
          <dt className="text-sm text-ink-subtle">Personas</dt>
          <dd className="font-mono text-sm text-ink">{plan.personaCount}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-line pb-1">
          <dt className="text-sm text-ink-subtle">Datasets</dt>
          <dd className="font-mono text-sm text-ink">{plan.datasetCount}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-line pb-1">
          <dt className="text-sm text-ink-subtle">Model calls</dt>
          <dd className="font-mono text-sm text-ink">{plan.estimatedCalls}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-line pb-1">
          <dt className="text-sm text-ink-subtle">Provider</dt>
          <dd className="font-mono text-sm text-ink">{plan.modelId}</dd>
        </div>
        <div className="flex justify-between gap-4 border-b border-line pb-1">
          <dt className="text-sm text-ink-subtle">Estimated cost</dt>
          <dd className="font-mono text-sm text-ink">
            {plan.isMock ? '$0.00' : `~$${plan.estimatedCostUsd.toFixed(2)}`}
          </dd>
        </div>
      </dl>

      {plan.isMock ? (
        <p className="mt-4 rounded border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
          This run will use the local mock provider. <strong>No AI model will be consulted.</strong>{' '}
          The outputs exercise the pipeline and are not evidence of anything — they are labelled as
          mock everywhere they appear, including in any export.
        </p>
      ) : (
        <p className="mt-4 text-xs text-ink-subtle">
          The cost is an estimate from published token prices, not an invoice. The run stops on its
          own if it reaches its ${plan.budgetCapUsd.toFixed(2)} cap.
        </p>
      )}

      <p className="mt-3 max-w-prose text-xs text-ink-subtle">
        Whatever this run produces is a simulation. It is decision support, not evidence of what any
        real person thinks, and it does not replace research with real people.
      </p>

      <p className="mt-3 font-mono text-[10px] text-ink-subtle">plan {plan.planHash.slice(0, 16)}…</p>

      <form action={action} className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="runId" value={plan.runId} />
        <input type="hidden" name="planHash" value={plan.planHash} />
        <FormMessages state={state} />
        <SubmitButton pendingLabel="Starting…">Confirm and run</SubmitButton>
      </form>
    </div>
  );
}

/**
 * Plan the same run again: same cohort, same seed. It creates a new plan that still has to be
 * confirmed — nothing runs from this button.
 */
export function RerunButton({ projectId, cohortId, seed }: { projectId: string; cohortId: string; seed: number }) {
  const [state, action] = useActionState(planRunAction, empty);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="seed" value={seed} />
      <button type="submit" className="rounded border border-line-strong px-3 py-1.5 text-xs text-ink-muted hover:border-brand hover:text-ink">
        Plan a rerun
      </button>
      {state.error && <span role="alert" className="text-xs text-danger">{state.error}</span>}
      {state.problems && <span role="alert" className="text-xs text-danger">{state.problems.join(' ')}</span>}
    </form>
  );
}
