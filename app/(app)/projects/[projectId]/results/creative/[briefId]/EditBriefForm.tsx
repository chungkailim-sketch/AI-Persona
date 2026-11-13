'use client';

import { useActionState, useState } from 'react';
import { saveCreativeBriefAction } from '../../../journeyActions';
import { FormMessages, SubmitButton, TextArea, TextInput } from '@/ui/forms';
import type { FormState } from '../../../actions';

const empty: FormState = {};

interface Section { title: string; fields: { key: string; label: string; hint: string; value: string }[] }

export function EditBriefForm({ projectId, briefId, sections, shots: initial }: { projectId: string; briefId: string; sections: Section[]; shots: { title: string; prompt: string }[] }) {
  const [state, action] = useActionState(saveCreativeBriefAction, empty);
  const [shots, setShots] = useState(initial.length ? initial : [{ title: '', prompt: '' }]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="briefId" value={briefId} />
      {sections.map((s) => (
        <details key={s.title} className="panel" open>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">{s.title}</summary>
          <div className="flex flex-col gap-3 border-t border-line px-4 py-4">
            {s.title.startsWith('9.') && (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-ink">Master prompt (per shot)</p>
                {shots.map((shot, i) => (
                  <div key={i} className="flex flex-col gap-1.5 rounded border border-line px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={`shot-${i}`} className="text-xs font-semibold text-ink-muted">{`Shot ${i + 1}`}</label>
                      <button type="button" className="text-xs text-danger underline-offset-2 hover:underline" onClick={() => setShots(shots.filter((_, j) => j !== i))}>Remove</button>
                    </div>
                    <TextInput name="shotTitle" defaultValue={shot.title} maxLength={120} aria-label={`Shot ${i + 1} title`} placeholder="Title" />
                    <TextArea id={`shot-${i}`} name="shotPrompt" defaultValue={shot.prompt} rows={3} maxLength={2000} />
                  </div>
                ))}
                {shots.length < 12 && (
                  <button type="button" className="self-start text-xs font-medium text-link underline-offset-2 hover:underline" onClick={() => setShots([...shots, { title: '', prompt: '' }])}>
                    Add a shot
                  </button>
                )}
              </div>
            )}
            {s.fields.map((f) => (
              <div key={f.key} className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
                <label htmlFor={`f-${f.key}`} className="pt-2 text-sm font-medium text-ink">
                  {f.label}
                  <span className="block text-xs font-normal text-ink-subtle">{f.hint}</span>
                </label>
                <TextArea id={`f-${f.key}`} name={`f.${f.key}`} defaultValue={f.value} rows={Math.min(5, Math.max(2, Math.ceil(f.value.length / 90)))} maxLength={2000} />
              </div>
            ))}
          </div>
        </details>
      ))}
      <FormMessages state={state} />
      <div><SubmitButton pendingLabel="Saving…">Save the brief</SubmitButton></div>
    </form>
  );
}
