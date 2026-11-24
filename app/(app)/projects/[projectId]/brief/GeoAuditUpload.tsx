'use client';

import { useActionState } from 'react';
import { importGeoAuditAction, manageGeoAuditAction } from '../journeyActions';
import { FormMessages, SubmitButton } from '@/ui/forms';
import { localize } from '@/ui/i18n/translate';
import type { FormState } from '../actions';

const empty: FormState = {};
const LINK = 'text-[11px] font-medium text-link underline-offset-2 hover:underline disabled:opacity-50';

/** Upload a GEO (AI visibility) audit; it is read and folded into the communication strategy and the report. */
export function GeoAuditUpload({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(importGeoAuditAction, empty);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <label htmlFor="geo-file" className="text-sm font-semibold text-ink">Upload a GEO audit</label>
      <p id="geo-file-hint" className="text-xs text-ink-muted">
        An AI visibility (GEO) audit for a market: how AI answer engines name and cite the brand against competitors, by topic, engine and source. Any format, up to
        15 MB. Its figures are read, the gaps are worked out, and a GEO strategy for that market — content, go-to-market tactics, formats, channels, media relations
        and where to invest — is added to the plans and to the report. Upload one audit per market.
      </p>
      <input
        id="geo-file"
        name="file"
        type="file"
        required
        aria-describedby="geo-file-hint"
        className="block w-full max-w-md text-sm text-ink-muted file:mr-3 file:rounded-full file:border file:border-line file:bg-surface file:px-4 file:py-1.5 file:text-sm file:text-ink hover:file:border-line-strong"
      />
      <FormMessages state={state} />
      <div>
        <SubmitButton pendingLabel="Uploading…">Read the GEO audit</SubmitButton>
      </div>
    </form>
  );
}

/** Re-read or delete one uploaded audit. */
export function GeoAuditActions({ projectId, auditId, busy }: { projectId: string; auditId: string; busy: boolean }) {
  const [state, action, pending] = useActionState(manageGeoAuditAction, empty);
  if (busy) return null;
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-x-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="auditId" value={auditId} />
      <button type="submit" name="op" value="reread" disabled={pending} className={LINK}>Read again</button>
      <button
        type="submit"
        name="op"
        value="delete"
        disabled={pending}
        className="text-[11px] font-medium text-danger underline-offset-2 hover:underline disabled:opacity-50"
        onClick={(e) => {
          if (!window.confirm(localize('Delete this GEO audit? This cannot be undone.'))) e.preventDefault();
        }}
      >
        Delete
      </button>
      {state.error && <span role="alert" className="text-[11px] text-danger">{state.error}</span>}
      {state.problems?.map((p) => <span key={p} role="alert" className="text-[11px] text-danger">{p}</span>)}
    </form>
  );
}
