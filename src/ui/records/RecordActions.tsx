'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { localize } from '@/ui/i18n/translate';

export type RecordActionState = { ok?: string; error?: string; problems?: string[] };
const empty: RecordActionState = {};
const LINK = 'text-[11px] font-medium text-link underline-offset-2 hover:underline disabled:opacity-50';

/**
 * Secondary actions on one saved record (a debate, a plan): edit, re-run, download, delete — small
 * text buttons at the record's bottom right. Edit opens the record's set-up pre-filled, to change and
 * run as a new record; re-run and delete go through the server action with `op`.
 */
export function RecordActions({
  action,
  projectId,
  recordId,
  status,
  editHref,
  downloadHref,
  canManage,
  hidden,
  noun,
}: {
  action: (prev: RecordActionState, formData: FormData) => Promise<RecordActionState>;
  projectId: string;
  recordId: string;
  status: string;
  editHref: string;
  downloadHref?: string;
  canManage: boolean;
  /** Extra hidden form fields (e.g. where to return). */
  hidden?: Record<string, string>;
  /** What is deleted, for the confirmation: "debate", "plan". */
  noun: string;
}) {
  const [state, run, pending] = useActionState(action, empty);
  const busy = status === 'QUEUED' || status === 'RUNNING';
  const done = status === 'COMPLETED';
  return (
    <div className="flex flex-col items-end gap-0.5">
      <form action={run} className="flex flex-wrap items-center justify-end gap-x-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="recordId" value={recordId} />
        {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {canManage && <Link href={editHref as Route} className={LINK}>Edit</Link>}
        {canManage && !busy && <button type="submit" name="op" value="rerun" disabled={pending} className={LINK}>Re-run</button>}
        {done && downloadHref && <a href={downloadHref} className={LINK}>Download .md</a>}
        {canManage && !busy && (
          <button
            type="submit"
            name="op"
            value="delete"
            disabled={pending}
            className="text-[11px] font-medium text-danger underline-offset-2 hover:underline disabled:opacity-50"
            onClick={(e) => {
              if (!window.confirm(localize(`Delete this ${noun}? This cannot be undone.`))) e.preventDefault();
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
