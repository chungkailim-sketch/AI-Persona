'use client';

import { useActionState } from 'react';
import { setProjectAccessAction, type AdminActionState } from './actions';

const initial: AdminActionState = {};
const ROLES = [
  ['NONE', 'No access'],
  ['VIEWER', 'Viewer'],
  ['COLLABORATOR', 'Collaborator'],
  ['OWNER', 'Owner'],
] as const;

export interface AccessProject {
  id: string;
  name: string;
  status: string;
}

function AccessRow({ userId, project, role }: { userId: string; project: AccessProject; role: string | null }) {
  const [state, action, pending] = useActionState(setProjectAccessAction, initial);
  return (
    <li className="py-2.5">
      <form action={action} className="flex flex-wrap items-center justify-between gap-2">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="projectId" value={project.id} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {project.name} <span className="text-xs text-ink-subtle">{project.status.toLowerCase()}</span>
        </span>
        <label htmlFor={`acc-${userId}-${project.id}`} className="sr-only">Role on {project.name}</label>
        <select id={`acc-${userId}-${project.id}`} name="role" defaultValue={role ?? 'NONE'} className="rounded border border-line bg-bg px-2 py-1 text-xs text-ink">
          {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button type="submit" disabled={pending} className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-brand disabled:opacity-50">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </form>
      {(state.error || state.ok) && (
        <p aria-live="polite" className={state.error ? 'mt-1 text-xs text-danger' : 'mt-1 text-xs text-ok'}>{state.error ?? state.ok}</p>
      )}
    </li>
  );
}

/** Project access for one user: a role per project, or none. Super administrators only (the server checks again). */
export function ProjectAccess({ userId, email, projects, roles }: { userId: string; email: string; projects: AccessProject[]; roles: Record<string, string> }) {
  const count = Object.keys(roles).length;
  return (
    <details className="mt-3 border-t border-line pt-3">
      <summary className="cursor-pointer text-xs font-medium text-ink-muted hover:text-ink">
        Project access · {count} {count === 1 ? 'project' : 'projects'}
      </summary>
      <p className="mt-2 max-w-prose text-xs text-ink-subtle">
        Choose what {email} can do in each project. A viewer reads, a collaborator also edits and runs, an owner also manages members. Every change is recorded in the audit log.
      </p>
      {projects.length === 0 ? (
        <p className="mt-3 text-xs text-ink-subtle">There are no projects yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {projects.map((p) => <AccessRow key={p.id} userId={userId} project={p} role={roles[p.id] ?? null} />)}
        </ul>
      )}
    </details>
  );
}
