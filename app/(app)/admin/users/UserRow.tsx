'use client';

import { useActionState } from 'react';
import { changeRoleAction, setStatusAction, type AdminActionState } from './actions';

const initial: AdminActionState = {};

export interface UserRowProps {
  id: string;
  email: string;
  systemRole: string;
  status: string;
  lastLoginAt: string | null;
  projectCount: number;
  /** Roles this actor is permitted to assign. Computed on the server; the server checks again. */
  assignableRoles: readonly string[];
  isSelf: boolean;
  canManage: boolean;
}

export function UserRow(p: UserRowProps) {
  const [roleState, roleAction, rolePending] = useActionState(changeRoleAction, initial);
  const [statusState, statusAction, statusPending] = useActionState(setStatusAction, initial);
  const message = roleState.error ?? statusState.error ?? roleState.ok ?? statusState.ok;
  const isError = Boolean(roleState.error ?? statusState.error);

  return (
    <li className="rounded border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-ink">{p.email}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {p.status.toLowerCase()} · {p.projectCount}{' '}
            {p.projectCount === 1 ? 'project' : 'projects'} ·{' '}
            {p.lastLoginAt ? `last signed in ${p.lastLoginAt}` : 'never signed in'}
            {p.isSelf && ' · you'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {p.canManage && !p.isSelf && p.assignableRoles.length > 0 ? (
            <form action={roleAction} className="flex items-center gap-2">
              <input type="hidden" name="userId" value={p.id} />
              <label htmlFor={`role-${p.id}`} className="sr-only">
                System role for {p.email}
              </label>
              <select
                id={`role-${p.id}`}
                name="role"
                defaultValue={p.systemRole}
                className="rounded border border-line bg-bg px-2 py-1 text-xs text-ink"
              >
                <option value={p.systemRole} disabled>
                  {p.systemRole.toLowerCase().replace(/_/g, ' ')}
                </option>
                {p.assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {r.toLowerCase().replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={rolePending}
                className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-brand disabled:opacity-50"
              >
                {rolePending ? 'Saving…' : 'Change role'}
              </button>
            </form>
          ) : (
            <span className="rounded bg-bg px-2 py-1 font-mono text-[10px] text-ink-subtle">
              {p.systemRole.toLowerCase().replace(/_/g, ' ')}
            </span>
          )}

          {p.canManage && !p.isSelf && (
            <form action={statusAction}>
              <input type="hidden" name="userId" value={p.id} />
              <input
                type="hidden"
                name="status"
                value={p.status === 'DEACTIVATED' ? 'ACTIVE' : 'DEACTIVATED'}
              />
              <button
                type="submit"
                disabled={statusPending}
                className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-danger hover:text-danger disabled:opacity-50"
              >
                {p.status === 'DEACTIVATED' ? 'Reactivate' : 'Deactivate'}
              </button>
            </form>
          )}
        </div>
      </div>

      {message && (
        <p
          aria-live="polite"
          className={isError ? 'mt-2 text-xs text-danger' : 'mt-2 text-xs text-ok'}
        >
          {message}
        </p>
      )}
    </li>
  );
}
