'use client';

import { useActionState } from 'react';
import { guidanceAction } from './journeyActions';
import { FormMessages, SubmitButton } from '@/ui/forms';

import type { FormState } from './actions';
const empty: FormState = {};

export function GuidanceButton({ projectId, checkpoint, subjectId, label }: { projectId: string; checkpoint: string; subjectId?: string; label: string }) {
  const [state, action] = useActionState(guidanceAction, empty);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="checkpoint" value={checkpoint} />
      {subjectId && <input type="hidden" name="subjectId" value={subjectId} />}
      <SubmitButton pendingLabel="Asking…" variant="secondary">{label}</SubmitButton>
      <FormMessages state={state} />
    </form>
  );
}
