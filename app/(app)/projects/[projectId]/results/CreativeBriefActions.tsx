'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { manageCreativeBriefAction } from '../journeyActions';
import type { FormState } from '../actions';

const empty: FormState = {};
const LINK = 'text-xs font-medium text-link underline-offset-2 hover:underline disabled:opacity-50';

/** Secondary actions on one written brief: edit, regenerate, download as Markdown, delete. */
export function CreativeBriefActions({ projectId, briefId, status, canManage }: { projectId: string; briefId: string; status: string; canManage: boolean }) {
  const [state, action, pending] = useActionState(manageCreativeBriefAction, empty);
  const done = status === 'COMPLETED';
  const busy = status === 'QUEUED' || status === 'RUNNING';
  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action} className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="briefId" value={briefId} />
        {canManage && done && <Link href={`/projects/${projectId}/results/creative/${briefId}` as Route} className={LINK}>Edit</Link>}
        {canManage && !busy && <button type="submit" name="op" value="regenerate" disabled={pending} className={LINK}>Regenerate</button>}
        {done && <a href={`/api/projects/${projectId}/creative-brief/${briefId}/md`} className={LINK}>Download .md</a>}
        {canManage && !busy && (
          <button
            type="submit"
            name="op"
            value="delete"
            disabled={pending}
            className="text-xs font-medium text-danger underline-offset-2 hover:underline disabled:opacity-50"
            onClick={(e) => {
              if (!window.confirm('Delete this creative brief? This cannot be undone.')) e.preventDefault();
            }}
          >
            Delete
          </button>
        )}
      </form>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      {state.problems?.map((p) => <p key={p} role="alert" className="text-xs text-danger">{p}</p>)}
      {state.ok && <p role="status" className="text-xs text-ok">{state.ok}</p>}
    </div>
  );
}
