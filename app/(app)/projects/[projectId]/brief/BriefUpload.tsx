'use client';

import { useActionState } from 'react';
import { importBriefAction } from '../journeyActions';
import { FormMessages, SubmitButton } from '@/ui/forms';
import type { FormState } from '../actions';

const empty: FormState = {};

/** Upload a client brief in any format; it is read and fills in the form below. */
export function BriefUpload({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const [state, action] = useActionState(importBriefAction, empty);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <label htmlFor="brief-file" className="text-sm font-semibold text-ink">Upload a brief</label>
      <p id="brief-file-hint" className="text-xs text-ink-muted">
        Any format: PDF, Word, PowerPoint, Excel, text, or a photo of a printed brief (up to 15 MB). It is turned into a structured document and fills in the
        markets, question, categories and audience below, adds hypotheses for testing, and suggests the agent swarm set-up.
      </p>
      <input
        id="brief-file"
        name="file"
        type="file"
        required
        disabled={disabled}
        aria-describedby="brief-file-hint"
        className="block w-full max-w-md text-sm text-ink-muted file:mr-3 file:rounded-full file:border file:border-line file:bg-surface file:px-4 file:py-1.5 file:text-sm file:text-ink hover:file:border-line-strong"
      />
      <FormMessages state={state} />
      <div>
        <SubmitButton pendingLabel="Uploading…">Read the brief</SubmitButton>
      </div>
    </form>
  );
}
