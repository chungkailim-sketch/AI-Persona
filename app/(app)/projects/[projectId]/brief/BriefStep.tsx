'use client';

import { useActionState, useState } from 'react';
import {
  saveBriefAction,
  addHypothesisAction,
  addStimulusAction,
  removeHypothesisAction,
  type FormState,
} from '../actions';
import { Field, FormMessages, Select, SubmitButton, TextArea, TextInput } from '@/ui/forms';

/**
 * Note on validation: these fields carry `required` but not `minLength`.
 *
 * `required` is a presence rule the browser can state for itself and assistive technology
 * announces. Substance rules — "say what would count as support" — live on the server, because
 * they need an explanation rather than a rejection, and a `minLength` here would block the
 * submission before the server ever got to give that explanation.
 */

const empty: FormState = {};

export interface BriefDefaults {
  briefId: string;
  businessContext: string;
  researchQuestion: string;
  objective: string;
  decisionSupported: string;
  targetAudience: string;
  markets: string;
  timePeriod: string;
  competitors: string;
  desiredOutcome: string;
  constraints: string;
  exclusions: string;
  prohibitedInferences: string;
  personaCount: number;
  runCount: number;
  simulationDepth: string;
  confidenceRequirement: string;
  reportAudience: string;
  locked: boolean;
}

export function BriefForm({
  projectId,
  defaults,
  desiredOutcomeNotice,
}: {
  projectId: string;
  defaults: BriefDefaults;
  desiredOutcomeNotice: string;
}) {
  const [state, action] = useActionState(saveBriefAction, empty);

  return (
    <form action={action} className="mt-4 flex max-w-2xl flex-col gap-5">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="briefId" value={defaults.briefId} />

      <Field
        id="researchQuestion"
        label="What are you trying to find out?"
        required
        hint="One question, stated plainly. If there are three, this is three runs."
      >
        <TextArea
          id="researchQuestion"
          name="researchQuestion"
          required
          rows={2}
          defaultValue={defaults.researchQuestion}
          aria-describedby="researchQuestion-hint"
        />
      </Field>

      <Field
        id="decisionSupported"
        label="What decision will this inform?"
        required
        hint="A run with no decision behind it cannot be judged useful or useless afterwards."
      >
        <TextArea
          id="decisionSupported"
          name="decisionSupported"
          required
          rows={2}
          defaultValue={defaults.decisionSupported}
          aria-describedby="decisionSupported-hint"
        />
      </Field>

      <Field id="objective" label="Objective" hint="Shapes how results are presented.">
        <Select id="objective" name="objective" defaultValue={defaults.objective || 'explore'}>
          <option value="explore">Explore — map the territory</option>
          <option value="test">Test — check specific hypotheses</option>
          <option value="compare">Compare — weigh options against each other</option>
          <option value="stress">Stress — find where a plan breaks</option>
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="markets" label="Markets" required hint="Comma separated.">
          <TextInput id="markets" name="markets" required defaultValue={defaults.markets} />
        </Field>
        <Field id="timePeriod" label="Time period in scope">
          <TextInput id="timePeriod" name="timePeriod" defaultValue={defaults.timePeriod} />
        </Field>
        <Field id="targetAudience" label="Audience">
          <TextInput id="targetAudience" name="targetAudience" defaultValue={defaults.targetAudience} />
        </Field>
        <Field id="competitors" label="Competitors named" hint="Comma separated.">
          <TextInput id="competitors" name="competitors" defaultValue={defaults.competitors} />
        </Field>
      </div>

      <Field id="businessContext" label="Background">
        <TextArea
          id="businessContext"
          name="businessContext"
          rows={3}
          defaultValue={defaults.businessContext}
        />
      </Field>

      <fieldset className="rounded border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-medium text-ink">
          What you are hoping to find
        </legend>
        <p className="max-w-prose text-xs text-ink-subtle">{desiredOutcomeNotice}</p>
        <TextArea
          id="desiredOutcome"
          name="desiredOutcome"
          rows={2}
          defaultValue={defaults.desiredOutcome}
          aria-label="Desired outcome"
          className="mt-2"
        />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="exclusions"
          label="Out of scope"
          hint="Comma separated. Things the run must not address."
        >
          <TextInput id="exclusions" name="exclusions" defaultValue={defaults.exclusions} />
        </Field>
        <Field
          id="prohibitedInferences"
          label="Inferences not to draw"
          hint="Comma separated. E.g. anything about health, or about individuals."
        >
          <TextInput
            id="prohibitedInferences"
            name="prohibitedInferences"
            defaultValue={defaults.prohibitedInferences}
          />
        </Field>
      </div>

      <Field id="constraints" label="Constraints">
        <TextArea id="constraints" name="constraints" rows={2} defaultValue={defaults.constraints} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="personaCount" label="Cohort size" required>
          <TextInput
            id="personaCount"
            name="personaCount"
            type="number"
            min={3}
            max={60}
            required
            defaultValue={defaults.personaCount}
          />
        </Field>
        <Field id="runCount" label="Repeat runs" required>
          <TextInput
            id="runCount"
            name="runCount"
            type="number"
            min={1}
            max={10}
            required
            defaultValue={defaults.runCount}
          />
        </Field>
        <Field id="simulationDepth" label="Depth">
          <Select
            id="simulationDepth"
            name="simulationDepth"
            defaultValue={defaults.simulationDepth}
          >
            <option value="quick">Quick</option>
            <option value="standard">Standard</option>
            <option value="deep">Deep</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="confidenceRequirement"
          label="Confidence needed"
          hint="How sure does this decision need you to be?"
        >
          <TextInput
            id="confidenceRequirement"
            name="confidenceRequirement"
            defaultValue={defaults.confidenceRequirement}
          />
        </Field>
        <Field id="reportAudience" label="Who reads the report">
          <TextInput id="reportAudience" name="reportAudience" defaultValue={defaults.reportAudience} />
        </Field>
      </div>

      <FormMessages state={state} />
      <SubmitButton pendingLabel="Saving…">Save brief</SubmitButton>
    </form>
  );
}

// ── Hypotheses ────────────────────────────────────────────────────────────────

export interface HypothesisRow {
  id: string;
  label: string;
  statement: string;
  operationalDefinition: string | null;
  nullHypothesis: string | null;
  minimumEvidenceThreshold: string;
  alternativeExplanations: string[];
}

export function HypothesisList({
  projectId,
  hypotheses,
  canEdit,
}: {
  projectId: string;
  hypotheses: HypothesisRow[];
  canEdit: boolean;
}) {
  if (hypotheses.length === 0) {
    return (
      <p className="mt-3 rounded border border-warn bg-warn-soft/40 px-4 py-3 text-sm text-ink-muted">
        No hypothesis stated yet. Without one there is nothing for the run to test, and the result
        will be a description rather than an answer.
      </p>
    );
  }

  return (
    <ul className="mt-3 flex flex-col gap-3">
      {hypotheses.map((h) => (
        <li key={h.id} className="rounded border border-line bg-surface px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="rounded bg-bg px-2 py-0.5 font-mono text-[10px] uppercase text-ink-muted">
                {h.label}
              </span>
              <p className="mt-2 text-sm text-ink">{h.statement}</p>
            </div>
            {canEdit && (
              <form action={removeHypothesisAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="hypothesisId" value={h.id} />
                <button
                  type="submit"
                  className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-danger hover:text-danger"
                >
                  Remove
                </button>
              </form>
            )}
          </div>

          <dl className="mt-3 flex flex-col gap-2 text-xs">
            <div>
              <dt className="font-medium text-ink-muted">
                What would count as support (set in advance)
              </dt>
              <dd className="mt-0.5 text-ink-subtle">{h.minimumEvidenceThreshold}</dd>
            </div>
            {h.operationalDefinition && (
              <div>
                <dt className="font-medium text-ink-muted">How it is measured</dt>
                <dd className="mt-0.5 text-ink-subtle">{h.operationalDefinition}</dd>
              </div>
            )}
            {h.nullHypothesis && (
              <div>
                <dt className="font-medium text-ink-muted">What it would mean if false</dt>
                <dd className="mt-0.5 text-ink-subtle">{h.nullHypothesis}</dd>
              </div>
            )}
            {h.alternativeExplanations.length > 0 && (
              <div>
                <dt className="font-medium text-ink-muted">Other explanations to rule out</dt>
                <dd className="mt-0.5 text-ink-subtle">
                  {h.alternativeExplanations.join('; ')}
                </dd>
              </div>
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
}

export function AddHypothesisForm({
  projectId,
  briefId,
  nextLabel,
}: {
  projectId: string;
  briefId: string;
  nextLabel: string;
}) {
  const [state, action] = useActionState(addHypothesisAction, empty);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 rounded border border-line px-4 py-2 text-sm text-ink-muted hover:border-brand"
      >
        Add a hypothesis
      </button>
    );
  }

  return (
    <form action={action} className="mt-4 flex max-w-2xl flex-col gap-4 rounded border border-line bg-surface p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="briefId" value={briefId} />

      <div className="grid gap-4 sm:grid-cols-[6rem_1fr]">
        <Field id="label" label="Label">
          <TextInput id="label" name="label" defaultValue={nextLabel} maxLength={8} />
        </Field>
        <Field
          id="statement"
          label="The claim"
          required
          hint="Stated so that it could turn out to be false."
        >
          <TextArea
            id="statement"
            name="statement"
            required
            rows={2}
            aria-describedby="statement-hint"
          />
        </Field>
      </div>

      <Field
        id="minimumEvidenceThreshold"
        label="What would count as support?"
        required
        hint="Decide this before you see the result. Deciding afterwards is how any result becomes confirmation."
      >
        <TextArea
          id="minimumEvidenceThreshold"
          name="minimumEvidenceThreshold"
          required
          rows={2}
          aria-describedby="minimumEvidenceThreshold-hint"
        />
      </Field>

      <Field
        id="operationalDefinition"
        label="How will it be measured?"
        hint="Which fields, and what counts as the outcome."
      >
        <TextArea id="operationalDefinition" name="operationalDefinition" rows={2} />
      </Field>

      <Field id="nullHypothesis" label="What would it mean if this were false?">
        <TextArea id="nullHypothesis" name="nullHypothesis" rows={2} />
      </Field>

      <Field
        id="alternativeExplanations"
        label="Other explanations to rule out"
        hint="Comma separated. What else could produce the same pattern?"
      >
        <TextInput id="alternativeExplanations" name="alternativeExplanations" />
      </Field>

      <FormMessages state={state} />
      <div className="flex gap-2">
        <SubmitButton pendingLabel="Adding…">Add hypothesis</SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-line px-4 py-2 text-sm text-ink-muted hover:border-brand"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Stimuli ───────────────────────────────────────────────────────────────────

export function AddStimulusForm({
  projectId,
  briefId,
}: {
  projectId: string;
  briefId: string;
}) {
  const [state, action] = useActionState(addStimulusAction, empty);

  return (
    <form action={action} className="mt-4 flex max-w-2xl flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="briefId" value={briefId} />

      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field id="stim-label" label="Label">
          <TextInput id="stim-label" name="label" placeholder="Variant A" maxLength={24} />
        </Field>
        <Field id="stim-name" label="Name">
          <TextInput id="stim-name" name="name" maxLength={120} />
        </Field>
      </div>

      <Field
        id="stim-content"
        label="Material"
        required
        hint="Paste the concept, message or copy. It is stored and used as data — text inside it that reads like an instruction is never treated as one."
      >
        <TextArea
          id="stim-content"
          name="content"
          required
          rows={6}
          maxLength={20000}
          aria-describedby="stim-content-hint"
        />
      </Field>

      <FormMessages state={state} />
      <SubmitButton pendingLabel="Adding…">Add stimulus</SubmitButton>
    </form>
  );
}
