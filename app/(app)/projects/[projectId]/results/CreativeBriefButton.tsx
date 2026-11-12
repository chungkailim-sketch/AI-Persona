'use client';

import { useActionState } from 'react';
import { requestCreativeBriefAction } from '../journeyActions';
import { FormMessages, SubmitButton } from '@/ui/forms';
import type { FormState } from '../actions';

const empty: FormState = {};

export function CreativeBriefButton({ projectId, again }: { projectId: string; again: boolean }) {
  const [state, action] = useActionState(requestCreativeBriefAction, empty);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <FormMessages state={state} />
      <div><SubmitButton pendingLabel="Starting…">{again ? 'Generate a new version' : 'Generate the creative brief'}</SubmitButton></div>
    </form>
  );
}
