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
      <SubmitButton pendingLabel="Starting…">{label}</SubmitButton>
      <FormMessages state={state} />
    </form>
  );
}
