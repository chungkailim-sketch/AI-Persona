'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { localize } from '@/ui/i18n/translate';
import { manageDebateAction, type FormState } from '../actions';

const empty: FormState = {};
const LINK = 'text-[11px] font-medium text-link underline-offset-2 hover:underline disabled:opacity-50';

/** Secondary actions on one recent debate: edit (a pre-filled set-up to run again), re-run, delete. */
export function DebateRecordActions({ projectId, debateId, status, base }: { projectId: string; debateId: string; status: string; base: 'personas' | 'advanced/personas' }) {
  const [state, action, pending] = useActionState(manageDebateAction, empty);
  const busy = status === 'QUEUED' || status === 'RUNNING';
  return (
    <div className="flex flex-col items-end gap-0.5 px-3.5 pb-2">
      <form action={action} className="flex flex-wrap items-center justify-end gap-x-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="debateId" value={debateId} />
        {base === 'personas' && <input type="hidden" name="returnTo" value="journey" />}
        <Link href={`/projects/${projectId}/${base}?edit=${debateId}#debate` as Route} className={LINK}>Edit</Link>
        {!busy && <button type="submit" name="op" value="rerun" disabled={pending} className={LINK}>Re-run</button>}
        {!busy && (
          <button
            type="submit"
            name="op"
            value="delete"
            disabled={pending}
            className="text-[11px] font-medium text-danger underline-offset-2 hover:underline disabled:opacity-50"
            onClick={(e) => {
              if (!window.confirm(localize('Delete this debate and its transcript? This cannot be undone.'))) e.preventDefault();
            }}
          >
            Delete
          </button>
        )}
      </form>
      {state.error && <p role="alert" className="text-[11px] text-danger">{state.error}</p>}
      {state.problems?.map((p) => <p key={p} role="alert" className="text-[11px] text-danger">{p}</p>)}
    </div>
  );
}
