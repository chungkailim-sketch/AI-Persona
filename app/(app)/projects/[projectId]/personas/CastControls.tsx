'use client';

import { useActionState, useState } from 'react';
import { approveCastAction, buildCastAction, renamePersonaAction } from '../journeyActions';
import { FormMessages, SubmitButton, TextInput } from '@/ui/forms';
import type { FormState } from '../actions';

const empty: FormState = {};

export function BuildCastButton({ projectId, label, variant = 'primary' }: { projectId: string; label: string; variant?: 'primary' | 'secondary' }) {
  const [state, action] = useActionState(buildCastAction, empty);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <SubmitButton pendingLabel="Starting…" variant={variant}>{label}</SubmitButton>
      <FormMessages state={state} />
    </form>
  );
}

export function ApproveCastButton({ projectId, cohortId }: { projectId: string; cohortId: string }) {
  const [state, action] = useActionState(approveCastAction, empty);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="cohortId" value={cohortId} />
      <SubmitButton pendingLabel="Approving…">Approve cast</SubmitButton>
      <FormMessages state={state} />
    </form>
  );
}

/** Rename one persona in place; the illustrative name is the team's to choose. */
export function RenamePersona({ projectId, personaId, name }: { projectId: string; personaId: string; name: string }) {
  const [state, action] = useActionState(renamePersonaAction, empty);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-[11px] text-ink-subtle underline hover:text-ink">
        Rename
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="personaId" value={personaId} />
      <TextInput name="name" defaultValue={name.replace(/^\[MOCK\]\s*/, '')} maxLength={60} aria-label="Persona name" className="py-1 text-xs" />
      <div className="flex gap-2">
        <SubmitButton pendingLabel="Saving…" variant="secondary">Save</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-muted underline">Cancel</button>
      </div>
      <FormMessages state={state} />
    </form>
  );
}
