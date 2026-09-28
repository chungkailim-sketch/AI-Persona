'use client';

import { useActionState } from 'react';
import { adherenceCheckAction, buildPopulationAction, cohortFromPopulationAction, type FormState } from '../actions';
import { Field, FormMessages, Select, SubmitButton, TextInput } from '@/ui/forms';
import { TZ_LABEL } from '@/lib/time';

const empty: FormState = {};

export interface PopulationSourceView {
  id: string;
  label: string;
  usable: boolean;
  groups: string[];
}

export function PopulationForm({ projectId, sources }: { projectId: string; sources: PopulationSourceView[] }) {
  const [state, action] = useActionState(buildPopulationAction, empty);
  const usable = sources.filter((s) => s.usable);
  const groups = [...new Set(usable.flatMap((s) => s.groups))].filter((g) => g.toLowerCase() !== 'all');
  const primaryDefault = groups.find((g) => /age/i.test(g)) ?? groups[0] ?? '';
  if (usable.length === 0) {
    return <p className="text-sm text-ink-muted">No cleared dataset with a wave-by-wave survey table. Clear one in step 1 first.</p>;
  }
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="sm:col-span-2">
        <Field id="pop-source" label="Source dataset">
          <Select id="pop-source" name="datasetVersionId" defaultValue={usable[0]!.id}>
            {usable.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field id="pop-primary" label="Stratify by" hint="Answers are drawn from this group's segments.">
        <Select id="pop-primary" name="primaryGroup" defaultValue={primaryDefault}>
          {groups.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </Select>
      </Field>
      <Field id="pop-secondary" label="Cross with (optional)" hint="Crossed by the product of marginals; stated as an assumption.">
        <Select id="pop-secondary" name="secondaryGroup" defaultValue="">
          <option value="">None</option>
          {groups.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </Select>
      </Field>
      <Field id="pop-size" label="Members" hint="50 to 20,000.">
        <TextInput id="pop-size" name="size" type="number" min={50} max={20000} step={1} defaultValue={2000} required />
      </Field>
      <Field id="pop-seed" label="Seed" hint="Same data, spec and seed rebuild the same population.">
        <TextInput id="pop-seed" name="seed" type="number" min={0} step={1} defaultValue={42} required />
      </Field>
      <div className="sm:col-span-2">
        <FormMessages state={state} />
        <div className="mt-2">
          <SubmitButton pendingLabel="Sampling…">Build population sample</SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function CohortFromPopulationForm({ projectId, sampleId, cells, defaultCount }: { projectId: string; sampleId: string; cells: number; defaultCount: number }) {
  const [state, action] = useActionState(cohortFromPopulationAction, empty);
  return (
    <form action={action} className="mt-1 flex flex-col gap-3 rounded border border-line bg-surface px-3.5 py-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="sampleId" value={sampleId} />
      <p className="text-sm text-ink">Turn this sample into a cohort</p>
      <p className="text-xs text-ink-subtle">
        One persona per cell, largest first ({cells} cells available). Each carries its segment&rsquo;s published answer
        distributions with the base, and is weighted by its cell&rsquo;s share. Candidates still need approval.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="pc-count" label="Personas" hint={`2 to 60. Above ${cells}, extra personas repeat the largest cells and share their weight.`}>
          <TextInput id="pc-count" name="personaCount" type="number" min={2} max={60} step={1} defaultValue={defaultCount} required />
        </Field>
        <Field id="pc-name" label="Cohort name (optional)">
          <TextInput id="pc-name" name="name" maxLength={120} />
        </Field>
      </div>
      <FormMessages state={state} />
      <div>
        <SubmitButton pendingLabel="Creating…" variant="secondary">Create cohort from sample</SubmitButton>
      </div>
    </form>
  );
}

export interface AdherenceView {
  verdict: string;
  when: string;
  model: string;
  statement: string | null;
  reason: string;
  withTrait: { key: string; agreePct: number; answer: string | null; inLine: boolean }[];
  withoutTrait: { key: string; agreePct: number; answer: string | null; inLine: boolean }[];
}

const VERDICT: Record<string, { label: string; tone: string }> = {
  pass: { label: 'Adherence: pass', tone: 'border-ok/40 bg-ok-soft text-ok' },
  fail: { label: 'Adherence: fail', tone: 'border-danger/40 bg-danger-soft text-danger' },
  not_evaluated: { label: 'Adherence: not evaluated', tone: 'border-line text-ink-muted' },
  not_applicable: { label: 'Adherence: not applicable', tone: 'border-line text-ink-muted' },
};

export function AdherencePanel({ projectId, cohortId, latest, canRun }: { projectId: string; cohortId: string; latest: AdherenceView | null; canRun: boolean }) {
  const [state, action] = useActionState(adherenceCheckAction, empty);
  const v = latest ? VERDICT[latest.verdict] ?? VERDICT.not_evaluated! : null;
  const side = (title: string, rows: AdherenceView['withTrait']) => (
    <div>
      <p className="text-[11px] text-ink-subtle">{title}</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {rows.map((r) => (
          <li key={r.key} className="flex gap-2 font-mono text-[11px]">
            <span className={r.inLine ? 'text-ok' : 'text-danger'}>{r.answer ? (r.inLine ? 'in line' : 'off') : '—'}</span>
            <span className="text-ink">{r.key}</span>
            <span className="text-ink-subtle">segment agrees {r.agreePct}% · answered {r.answer ?? 'n/a'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="mt-4 rounded border border-line bg-surface px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-sans text-sm font-medium text-ink">Persona adherence (contrast test)</h3>
        {v && <span className={`rounded-sm border px-1.5 font-mono text-[10.5px] ${v.tone}`}>{v.label}</span>}
      </div>
      <p className="mt-1 max-w-prose text-xs text-ink-subtle">
        Puts up to five personas whose segment mostly agreed with a statement, and up to five whose segment did not, to the
        same question. Passes when at least 80% on each side answer in line with their own segment — a panel that agrees
        with everything fails the second side.
      </p>
      {latest && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-ink">{latest.statement ? <>Statement: &ldquo;{latest.statement}&rdquo;. </> : null}{latest.reason}</p>
          {(latest.withTrait.length > 0 || latest.withoutTrait.length > 0) && latest.verdict !== 'not_evaluated' && (
            <div className="grid gap-2 md:grid-cols-2">
              {side('Segment mostly agreed', latest.withTrait)}
              {side('Segment mostly did not agree', latest.withoutTrait)}
            </div>
          )}
          <p className="font-mono text-[10.5px] text-ink-subtle">{latest.model} · {latest.when} {TZ_LABEL}</p>
        </div>
      )}
      {canRun && (
        <form action={action} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="cohortId" value={cohortId} />
          <FormMessages state={state} />
          <div>
            <SubmitButton pendingLabel="Probing personas…" variant="secondary">{latest ? 'Run the check again' : 'Run adherence check'}</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
