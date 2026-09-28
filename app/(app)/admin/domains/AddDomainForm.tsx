'use client';

import { useActionState } from 'react';
import { addDomainAction, type DomainActionState } from './actions';

const initial: DomainActionState = {};

export function AddDomainForm() {
  const [state, action, pending] = useActionState(addDomainAction, initial);
  return (
    <form action={action} className="mt-4 flex max-w-md flex-col gap-2">
      <label htmlFor="domain" className="text-sm font-medium text-ink">
        Domain
      </label>
      <div className="flex gap-2">
        <input
          id="domain"
          name="domain"
          required
          placeholder="example.com"
          aria-describedby="domain-help"
          className="flex-1 rounded border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-brand-ink disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
      <p id="domain-help" className="text-xs text-ink-subtle">
        Exact match only. Approving <code>example.com</code> does not approve
        <code> mail.example.com</code> — subdomains must be added separately.
      </p>
      {state.error && <p className="text-xs text-danger" aria-live="polite">{state.error}</p>}
      {state.ok && <p className="text-xs text-ok" aria-live="polite">{state.ok}</p>}
    </form>
  );
}
