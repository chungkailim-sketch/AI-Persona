'use client';

import { useActionState } from 'react';
import { createProjectAction, type ActionState } from './actions';

const initial: ActionState = {};

export function NewProjectForm() {
  const [state, action, pending] = useActionState(createProjectAction, initial);

  return (
    <form action={action} className="mt-6 flex max-w-lg flex-col gap-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-ink">
          Project name
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={120}
          aria-invalid={state.fieldErrors?.name ? true : undefined}
          aria-describedby={state.fieldErrors?.name ? 'name-error' : undefined}
          className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
        />
        {state.fieldErrors?.name && (
          <p id="name-error" className="mt-1 text-xs text-danger">{state.fieldErrors.name}</p>
        )}
      </div>
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-ink">
          What decision should this project inform? <span className="text-ink-subtle">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          maxLength={2000}
          className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
        />
      </div>
      {state.error && (
        <p className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded bg-brand px-4 py-2 text-sm font-medium text-brand-ink disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create project'}
      </button>
    </form>
  );
}
