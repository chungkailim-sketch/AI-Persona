'use client';

import { useActionState } from 'react';
import { startRoundtableAction } from '../journeyActions';
import { FormMessages, SubmitButton } from '@/ui/forms';
import type { FormState } from '../actions';

const empty: FormState = {};

export function StartRoundtableButton({ projectId, label }: { projectId: string; label: string }) {
  const [state, action] = useActionState(startRoundtableAction, empty);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="mb-1 text-xs font-semibold text-ink-muted">Who answers</legend>
        <label className="flex items-start gap-2 text-ink">
          <input type="radio" name="mode" value="auto" defaultChecked className="mt-1" />
          <span><strong>Relevant personas only</strong> (recommended)<br /><span className="text-xs text-ink-muted">The model activates the personas that fit the question, such as only Indonesian personas for a question about Indonesia. Each decision is shown with its reason.</span></span>
        </label>
        <label className="flex items-start gap-2 text-ink">
          <input type="radio" name="mode" value="all" className="mt-1" />
          <span><strong>Every persona</strong></span>
        </label>
      </fieldset>
      <SubmitButton pendingLabel="Starting…">{label}</SubmitButton>
      <FormMessages state={state} />
    </form>
  );
}
