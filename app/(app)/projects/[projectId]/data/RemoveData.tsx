'use client';

import { useActionState, useState } from 'react';
import { removeDatasetsAction, type FormState } from '../actions';
import { FormMessages, SubmitButton, TextInput } from '@/ui/forms';

const empty: FormState = {};

/** Remove one dataset. Asks once in the browser before submitting. */
export function RemoveDatasetButton({ projectId, datasetId, name }: { projectId: string; datasetId: string; name: string }) {
  const [state, action] = useActionState(removeDatasetsAction, empty);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Remove "${name}" and delete its stored files? Cohorts already built from it keep their record.`)) e.preventDefault();
      }}
      className="px-3.5 pb-2"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="datasetId" value={datasetId} />
      <button type="submit" className="text-[11px] text-ink-subtle underline hover:text-danger">Remove</button>
      {(state.error || state.problems) && <FormMessages state={state} />}
    </form>
  );
}

/** Remove every dataset attached to the project. Needs the words typed, not just a click. */
export function RemoveAllData({ projectId, count }: { projectId: string; count: number }) {
  const [state, action] = useActionState(removeDatasetsAction, empty);
  const [open, setOpen] = useState(false);
  if (count === 0 && !state.ok) return null;
  return (
    <div className="px-3.5 py-3">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-danger underline">
          Remove all source data ({count})
        </button>
      ) : (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="all" value="yes" />
          <p className="text-xs text-ink-muted">
            Removes all {count} dataset(s) from this project and deletes their stored files. Cohorts, runs and debates already built
            from them keep their record but nothing new can be built from them. Type <span className="font-mono">REMOVE ALL</span> to confirm.
          </p>
          <TextInput name="confirm" aria-label="Type REMOVE ALL to confirm" autoComplete="off" />
          <div className="flex gap-2">
            <SubmitButton pendingLabel="Removing…">Remove all</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-muted underline">Cancel</button>
          </div>
        </form>
      )}
      <FormMessages state={state} />
    </div>
  );
}
