'use client';
import { useActionState } from 'react';
import { generateHeadshotsAction, type HeadshotActionState } from './actions';

export function GenerateForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<HeadshotActionState, FormData>(generateHeadshotsAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input type="checkbox" name="force" /> Regenerate every portrait, including those already photographs
      </label>
      <div>
        <button type="submit" disabled={pending || disabled} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-50">
          {pending ? 'Starting…' : 'Generate photo headshots'}
        </button>
      </div>
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-ink-muted">{state.ok}</p>}
    </form>
  );
}
