'use client';

import { useActionState } from 'react';
import { toggleInReportAction } from '../journeyActions';
import type { FormState } from '../actions';

const empty: FormState = {};

/** Adds a finished plan or creative brief to the report preview (after Communications), or removes it. */
export function AddToReportButton({ projectId, adviceId, inReport }: { projectId: string; adviceId: string; inReport: boolean }) {
  const [state, action, pending] = useActionState(toggleInReportAction, empty);
  return (
    <form action={action} className="flex flex-col items-end">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="adviceId" value={adviceId} />
      <input type="hidden" name="on" value={inReport ? '0' : '1'} />
      <button type="submit" disabled={pending} className="text-[11px] font-medium text-link underline-offset-2 hover:underline disabled:opacity-50">
        {inReport ? 'Remove from report' : 'Add to report'}
      </button>
      {state.error && <p role="alert" className="text-[11px] text-danger">{state.error}</p>}
      {state.problems?.map((p) => <p key={p} role="alert" className="text-[11px] text-danger">{p}</p>)}
    </form>
  );
}
