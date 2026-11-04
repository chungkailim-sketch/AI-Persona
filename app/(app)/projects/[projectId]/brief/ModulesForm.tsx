'use client';

import { useActionState, useState } from 'react';
import { saveModulesAction } from '../journeyActions';
import { FormMessages, SubmitButton } from '@/ui/forms';
import { MODULES, USE_CASES, type ModuleKey } from '@/modules/registry';
import type { FormState } from '../actions';

const empty: FormState = {};

/** Choose the use case, which sets the modules; then switch individual modules on or off. */
export function ModulesForm({ projectId, useCase, active, canEdit }: { projectId: string; useCase: string; active: ModuleKey[]; canEdit: boolean }) {
  const [state, action] = useActionState(saveModulesAction, empty);
  const [uc, setUc] = useState(useCase);
  const [on, setOn] = useState<ModuleKey[]>(active);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink">Use case</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map((u) => (
            <label key={u.key} className="flex cursor-pointer gap-2 rounded border border-line bg-surface p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="radio" name="useCase" value={u.key} checked={uc === u.key} disabled={!canEdit} onChange={() => { setUc(u.key); setOn([...u.modules]); }} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold text-ink">{u.label}</span>
                <span className="block text-xs text-ink-subtle">{u.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink">Modules</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODULES.map((m) => (
            <label key={m.key} className="flex cursor-pointer gap-2 text-sm">
              <input type="checkbox" name="modules" value={m.key} checked={on.includes(m.key)} disabled={!canEdit} onChange={() => setOn(on.includes(m.key) ? on.filter((x) => x !== m.key) : [...on, m.key])} className="mt-1" />
              <span>
                <span className="font-medium text-ink">{m.label}</span>
                <span className="block text-xs text-ink-subtle">{m.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <FormMessages state={state} />
      {canEdit && <SubmitButton pendingLabel="Saving…" variant="secondary">Save set-up</SubmitButton>}
    </form>
  );
}
