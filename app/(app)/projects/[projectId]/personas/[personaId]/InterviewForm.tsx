'use client';

import { useActionState, useRef, useEffect } from 'react';
import { askPersonaAction } from '../../journeyActions';
import { FormMessages, SubmitButton, TextArea } from '@/ui/forms';
import type { FormState } from '../../actions';

const empty: FormState = {};

export const STARTERS = [
  'What do you look for when you buy something new?',
  'Would you try a Chinese brand? What would make you trust one?',
  'Where do you hear about new brands — which apps, sites or people?',
  'How much does price matter compared with quality for you?',
  'What would put you off a brand you had just discovered?',
];

export function InterviewForm({ projectId, personaId }: { projectId: string; personaId: string }) {
  const [state, action] = useActionState(askPersonaAction, empty);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="personaId" value={personaId} />
      <label htmlFor="iq" className="text-sm font-semibold text-ink">Ask a question</label>
      <TextArea id="iq" name="question" rows={2} maxLength={1500} required placeholder="e.g. What would make you try a new skincare brand?" />
      <div className="flex flex-wrap gap-1.5">
        {STARTERS.map((s) => (
          <button
            key={s}
            type="button"
            className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-muted hover:border-brand hover:text-ink"
            onClick={() => {
              const el = ref.current?.elements.namedItem('question') as HTMLTextAreaElement | null;
              if (el) el.value = s;
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <FormMessages state={{ ...state, ok: undefined }} />
      <SubmitButton pendingLabel="The persona is answering…">Ask</SubmitButton>
    </form>
  );
}
