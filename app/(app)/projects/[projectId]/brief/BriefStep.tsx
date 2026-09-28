'use client';

import { useActionState, useState } from 'react';
import {
  saveBriefAction,
  addHypothesisAction,
  addStimulusAction,
  removeHypothesisAction,
  type FormState,
} from '../actions';
import { Field, FormMessages, Select, SubmitButton, TextArea, TextInput, type FieldInfo, InfoTip } from '@/ui/forms';

/** Definitions and best-practice examples behind each brief field's "i". */
const BRIEF_INFO = {
  researchQuestion: {
    definition: "The single question this project exists to answer. Specific enough that a result could clearly answer it, and neutral about the answer.",
    example: "Among internet users in China and Indonesia, which age group is more receptive to advertising shown inside AI assistants?",
  },
  decisionSupported: {
    definition: "The business decision that will change depending on the answer. If no decision hangs on it, the result cannot be judged useful afterwards.",
    example: "Whether the 2027 CBGA media plan should allocate test budget to AI-assistant ad placements for 18-34s in Q1.",
  },
  objective: {
    definition: "What kind of study this is. It changes how results are framed: exploring a territory, testing a stated claim, comparing options, or stress-testing a plan.",
    example: "Test — we have a specific hypothesis about younger consumers and want it confirmed or refuted.",
  },
  markets: {
    definition: "The markets the question covers, matching the market names in your data so evidence can be selected for each.",
    example: "China, Indonesia, Mexico",
  },
  timePeriod: {
    definition: "The period the evidence and conclusions should cover — usually the survey waves in scope, or the planning window the decision applies to.",
    example: "Mintel waves March 2024 to March 2026; conclusions apply to 2027 planning.",
  },
  targetAudience: {
    definition: "Who the consumers in question are — the population the personas stand in for. Be as specific as the data allows.",
    example: "Internet users aged 16–34 in urban China who used an AI chatbot in the last month.",
  },
  competitors: {
    definition: "Brands or products the question, or the personas, may reasonably compare against. Leave empty if competition is not part of the question.",
    example: "Sephora, Watsons, Guardian",
  },
  businessContext: {
    definition: "The situation behind the question: what prompted it, what is already known, and any recent change in the market. Context, not conclusions.",
    example: "The client is considering sponsored placements in AI shopping assistants. Past Mintel waves show rising trust in AI recommendations among 18–24s, but no study has looked at advertising specifically.",
  },
  desiredOutcome: {
    definition: "What you are privately hoping the answer will be. It is recorded for the report so bias can be checked, and is never shown to the personas.",
    example: "We hope younger consumers are receptive enough to justify a pilot.",
  },
  exclusions: {
    definition: "Topics the run must not address, even if the evidence touches them.",
    example: "pricing strategy, retail distribution, B2B audiences",
  },
  prohibitedInferences: {
    definition: "Conclusions the run must never draw — typically anything the data cannot legitimately support.",
    example: "anything about individual respondents, health or medical claims, predictions of sales volume",
  },
  constraints: {
    definition: "Practical limits the answer has to respect: budget, timing, channels, brand or legal rules.",
    example: "Findings must be usable for a Q1 2027 media plan; the client cannot run ads to under-18s.",
  },
  personaCount: {
    definition: "How many personas the cohort should have — usually one per meaningful segment in the data. More is not better if segments become too small.",
    example: "8 — one per age group and gender cell with a base above 150.",
  },
  runCount: {
    definition: "How many times the simulation is repeated with different seeds. More repeats show how stable the result is.",
    example: "3 — enough to see whether the direction of the result holds across seeds.",
  },
  simulationDepth: {
    definition: "How much deliberation each run includes. Quick is for trying things out; deep adds more challenge and revision and costs more.",
    example: "Standard for a working answer; Deep before anything goes to the client.",
  },
  confidenceRequirement: {
    definition: "How certain the decision needs you to be, stated in plain terms. It sets the bar a result must clear before it is acted on.",
    example: "High — the result will be quoted in the client report, so it needs consistent support across markets and seeds.",
  },
  reportAudience: {
    definition: "Who will read the output, so it can be pitched at the right level of detail.",
    example: "Client marketing director and the RF Asia strategy team.",
  },
} satisfies Record<string, FieldInfo>;


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
info={BRIEF_INFO.researchQuestion}         label="What are you trying to find out?"
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
info={BRIEF_INFO.decisionSupported}         label="What decision will this inform?"
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

      <Field id="objective" info={BRIEF_INFO.objective} label="Objective" hint="Shapes how results are presented.">
        <Select id="objective" name="objective" defaultValue={defaults.objective || 'explore'}>
          <option value="explore">Explore — map the territory</option>
          <option value="test">Test — check specific hypotheses</option>
          <option value="compare">Compare — weigh options against each other</option>
          <option value="stress">Stress — find where a plan breaks</option>
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="markets" info={BRIEF_INFO.markets} label="Markets" required hint="Comma separated.">
          <TextInput id="markets" name="markets" required defaultValue={defaults.markets} />
        </Field>
        <Field id="timePeriod" info={BRIEF_INFO.timePeriod} label="Time period in scope">
          <TextInput id="timePeriod" name="timePeriod" defaultValue={defaults.timePeriod} />
        </Field>
        <Field id="targetAudience" info={BRIEF_INFO.targetAudience} label="Audience">
          <TextInput id="targetAudience" name="targetAudience" defaultValue={defaults.targetAudience} />
        </Field>
        <Field id="competitors" info={BRIEF_INFO.competitors} label="Competitors named" hint="Comma separated.">
          <TextInput id="competitors" name="competitors" defaultValue={defaults.competitors} />
        </Field>
      </div>

      <Field id="businessContext" info={BRIEF_INFO.businessContext} label="Background">
        <TextArea
          id="businessContext"
          name="businessContext"
          rows={3}
          defaultValue={defaults.businessContext}
        />
      </Field>

      <fieldset className="rounded border border-line bg-surface p-4">
        <legend className="flex items-center px-1 text-sm font-medium text-ink">
          What you are hoping to find
          <InfoTip id="desiredOutcome" info={BRIEF_INFO.desiredOutcome} />
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
info={BRIEF_INFO.exclusions}           label="Out of scope"
          hint="Comma separated. Things the run must not address."
        >
          <TextInput id="exclusions" name="exclusions" defaultValue={defaults.exclusions} />
        </Field>
        <Field
          id="prohibitedInferences"
info={BRIEF_INFO.prohibitedInferences}           label="Inferences not to draw"
          hint="Comma separated. E.g. anything about health, or about individuals."
        >
          <TextInput
            id="prohibitedInferences"
            name="prohibitedInferences"
            defaultValue={defaults.prohibitedInferences}
          />
        </Field>
      </div>

      <Field id="constraints" info={BRIEF_INFO.constraints} label="Constraints">
        <TextArea id="constraints" name="constraints" rows={2} defaultValue={defaults.constraints} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="personaCount" info={BRIEF_INFO.personaCount} label="Cohort size" required>
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
        <Field id="runCount" info={BRIEF_INFO.runCount} label="Repeat runs" required>
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
        <Field id="simulationDepth" info={BRIEF_INFO.simulationDepth} label="Depth">
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
info={BRIEF_INFO.confidenceRequirement}           label="Confidence needed"
          hint="How sure does this decision need you to be?"
        >
          <TextInput
            id="confidenceRequirement"
            name="confidenceRequirement"
            defaultValue={defaults.confidenceRequirement}
          />
        </Field>
        <Field id="reportAudience" info={BRIEF_INFO.reportAudience} label="Who reads the report">
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
