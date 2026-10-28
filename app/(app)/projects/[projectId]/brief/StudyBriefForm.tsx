'use client';

import { useActionState } from 'react';
import { saveStudyBriefAction } from '../journeyActions';
import { Field, FormMessages, SubmitButton, TextArea, TextInput } from '@/ui/forms';
import type { FormState } from '../actions';

const empty: FormState = {};

export interface StudyBriefView {
  context: string;
  markets: string[];
  question: string;
  categories: string[];
  audience: string;
}

/** The whole brief for the journey on one short form. */
export function StudyBriefForm({ projectId, brief, available, canEdit, locked }: { projectId: string; brief: StudyBriefView; available: string[]; canEdit: boolean; locked: boolean }) {
  const [state, action] = useActionState(saveStudyBriefAction, empty);
  // Markets already chosen stay listed even if their data has since been removed.
  const markets = [...new Set([...available, ...brief.markets])];
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="projectId" value={projectId} />
      {locked && (
        <p className="rounded border border-info/40 bg-info-soft px-3 py-2 text-sm text-ink">
          A roundtable has used this brief, so saving a change keeps it as it was and starts version 2 — a new cast and roundtable will use the new version.
        </p>
      )}
      <Field id="b-context" label="Brand and category context" hint="Who is entering, with what, and anything the personas should know. Optional.">
        <TextArea id="b-context" name="context" defaultValue={brief.context} maxLength={3000} rows={3} disabled={!canEdit} />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">
          Markets <span className="text-danger" aria-hidden>*</span>
        </legend>
        <p className="text-xs text-ink-subtle">Each market gets three personas, one per income tier. Markets come from the uploaded data.</p>
        {markets.length === 0 ? (
          <p className="text-sm text-warn">No market was found in the data yet. Upload databooks with a market column in step 1.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {markets.map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2 rounded border border-line bg-surface px-3 py-1.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="checkbox" name="markets" value={m} defaultChecked={brief.markets.includes(m)} disabled={!canEdit} />
                <span>{m}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <Field id="b-question" label="Roundtable question" required hint="The one question every persona answers.">
        <TextInput id="b-question" name="question" defaultValue={brief.question} maxLength={600} required disabled={!canEdit} />
      </Field>

      <Field id="b-categories" label="Categories" required hint="One per line. Every persona scores each from 0 to 100. Eight is a good number.">
        <TextArea id="b-categories" name="categories" defaultValue={brief.categories.join('\n')} rows={8} required disabled={!canEdit} />
      </Field>

      <Field id="b-audience" label="Audience or objective" hint="Optional, for the report cover.">
        <TextInput id="b-audience" name="audience" defaultValue={brief.audience} maxLength={300} disabled={!canEdit} />
      </Field>

      <FormMessages state={state} />
      {canEdit && <SubmitButton pendingLabel="Saving…">Save brief</SubmitButton>}
    </form>
  );
}
