'use client';

import { useActionState } from 'react';
import { generateCohortAction, approveCohortAction, type RunFormState } from '../runActions';
import { Field, FormMessages, Select, SubmitButton, TextInput } from '@/ui/forms';

const empty: RunFormState = {};

/**
 * Provenance is the thing this screen exists to make visible.
 *
 * Every attribute carries where it came from, in a chip that is readable at a glance and stated in
 * words rather than by colour alone — a persona whose attributes are all inferred is a character
 * sketch, and a reader has to be able to see that without being told.
 */
const ORIGIN_LABEL: Record<string, { label: string; cls: string; meaning: string }> = {
  OBSERVED: {
    label: 'observed',
    cls: 'bg-ok-soft text-ok',
    meaning: 'Measured directly in the data.',
  },
  DERIVED: {
    label: 'derived',
    cls: 'bg-info-soft text-info',
    meaning: 'Computed from measurements by a stated rule.',
  },
  INFERRED: {
    label: 'inferred',
    cls: 'bg-warn-soft text-warn',
    meaning: 'Proposed from the material. Not measured.',
  },
  USER_ENTERED: {
    label: 'entered',
    cls: 'bg-bg text-ink-muted',
    meaning: 'Typed by a person.',
  },
  SIMULATED: {
    label: 'simulated',
    cls: 'bg-danger-soft text-danger',
    meaning: 'Generated. Measures nothing and is not evidence.',
  },
};

export interface AttributeRow {
  id: string;
  group: string;
  label: string;
  value: string;
  origin: string;
  confidence: string;
  baseSize: number | null;
}

export interface PersonaRow {
  id: string;
  name: string;
  summary: string | null;
  segment: string | null;
  weight: number;
  baseSize: number | null;
  confidence: string;
  coverageNote: string | null;
  approval: string;
  attributes: AttributeRow[];
}

export interface CohortRow {
  id: string;
  name: string;
  generatedAt: string;
  generationNote: string | null;
  personas: PersonaRow[];
}

export function GenerateCohortForm({
  projectId,
  datasets,
  defaultCount,
}: {
  projectId: string;
  datasets: { id: string; label: string; usable: boolean; blockers: string[] }[];
  defaultCount: number;
}) {
  const [state, action] = useActionState(generateCohortAction, empty);
  const usable = datasets.filter((d) => d.usable);

  if (datasets.length === 0) {
    return (
      <p className="mt-4 max-w-prose rounded border border-warn bg-warn-soft/40 px-4 py-3 text-sm text-ink-muted">
        No dataset is attached to this project yet. A cohort describes segments in real data, so
        there is nothing to build one from.
      </p>
    );
  }

  if (usable.length === 0) {
    return (
      <div className="mt-4 max-w-prose rounded border border-warn bg-warn-soft/40 px-4 py-3">
        <p className="text-sm font-medium text-ink">
          No attached dataset has been cleared for use yet.
        </p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {datasets.flatMap((d) =>
            d.blockers.map((b) => (
              <li key={`${d.id}-${b}`} className="flex gap-2 text-sm text-ink-muted">
                <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-warn" />
                <span>
                  <span className="font-medium">{d.label}:</span> {b}
                </span>
              </li>
            )),
          )}
        </ul>
      </div>
    );
  }

  return (
    <form action={action} className="mt-4 flex max-w-xl flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />

      <Field id="datasetVersionId" label="Build from" required>
        <Select id="datasetVersionId" name="datasetVersionId" required>
          {usable.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="personaCount"
          label="How many personas"
          required
          hint="Segments in the data decide how many are distinct; the rest are labelled repeats."
        >
          <TextInput
            id="personaCount"
            name="personaCount"
            type="number"
            min={3}
            max={60}
            required
            defaultValue={defaultCount}
            aria-describedby="personaCount-hint"
          />
        </Field>
        <Field
          id="seed"
          label="Seed"
          hint="The same seed and the same data produce the same cohort."
        >
          <TextInput id="seed" name="seed" type="number" defaultValue={42} aria-describedby="seed-hint" />
        </Field>
      </div>

      <FormMessages state={state} />
      <SubmitButton pendingLabel="Generating…">Generate cohort</SubmitButton>
    </form>
  );
}

export function ApproveCohortForm({
  projectId,
  cohortId,
  alreadyApproved,
}: {
  projectId: string;
  cohortId: string;
  alreadyApproved: boolean;
}) {
  const [state, action] = useActionState(approveCohortAction, empty);

  if (alreadyApproved) {
    return (
      <p className="mt-3 rounded border border-ok bg-ok-soft px-3 py-2 text-sm text-ok">
        Approved. These persona versions are now immutable — a change creates a new version rather
        than editing what a completed run says it simulated.
      </p>
    );
  }

  return (
    <form action={action} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="cohortId" value={cohortId} />
      <p className="max-w-prose text-xs text-ink-subtle">
        Approving fixes these personas for use in a run. Read the provenance on each attribute
        first: an attribute marked <span className="font-mono">simulated</span> measures nothing.
      </p>
      <FormMessages state={state} />
      <SubmitButton pendingLabel="Approving…">Approve this cohort</SubmitButton>
    </form>
  );
}

export function OriginKey() {
  return (
    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
      {Object.entries(ORIGIN_LABEL).map(([key, o]) => (
        <div key={key} className="flex items-baseline gap-2">
          <dt>
            <span className={`rounded px-2 py-0.5 font-mono text-[10px] ${o.cls}`}>{o.label}</span>
          </dt>
          <dd className="text-xs text-ink-subtle">{o.meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PersonaCard({ persona }: { persona: PersonaRow }) {
  const simulatedOnly = persona.attributes.every((a) => a.origin === 'SIMULATED');

  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-ink">{persona.name}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {persona.baseSize !== null && `base ${persona.baseSize} · `}
            weight {(persona.weight * 100).toFixed(0)}% · confidence{' '}
            {persona.confidence.toLowerCase()}
          </p>
        </div>
        <span
          className={
            persona.approval === 'APPROVED'
              ? 'rounded bg-ok-soft px-2 py-0.5 font-mono text-[10px] text-ok'
              : 'rounded bg-bg px-2 py-0.5 font-mono text-[10px] text-ink-muted'
          }
        >
          {persona.approval.toLowerCase()}
        </span>
      </div>

      {persona.summary && <p className="mt-2 text-sm text-ink-muted">{persona.summary}</p>}

      {persona.coverageNote && (
        <p className="mt-2 rounded border border-warn bg-warn-soft/40 px-3 py-2 text-xs text-ink-muted">
          {persona.coverageNote}
        </p>
      )}

      {simulatedOnly && (
        <p className="mt-2 rounded border border-danger bg-danger-soft px-3 py-2 text-xs text-danger">
          Every attribute of this persona is simulated. It is a character sketch, not a description
          of anyone in the data.
        </p>
      )}

      <details className="group mt-3">
        <summary className="cursor-pointer select-none text-xs text-link underline-offset-2 hover:underline">
          {persona.attributes.length} attributes ·{' '}
          {persona.attributes.filter((a) => a.origin === 'OBSERVED' || a.origin === 'DERIVED').length} grounded in the data
        </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {persona.attributes.map((a) => {
          const o = ORIGIN_LABEL[a.origin] ?? ORIGIN_LABEL.USER_ENTERED!;
          return (
            <li key={a.id} className="flex flex-wrap items-baseline gap-2 text-xs">
              <span className={`rounded px-2 py-0.5 font-mono text-[10px] ${o.cls}`}>{o.label}</span>
              <span className="font-medium text-ink">{a.label}</span>
              <span className="text-ink-muted">{a.value}</span>
              {a.baseSize !== null && (
                <span className="font-mono text-[10px] text-ink-subtle">base {a.baseSize}</span>
              )}
            </li>
          );
        })}
      </ul>
      </details>
    </li>
  );
}
