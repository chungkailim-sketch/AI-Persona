import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { SYSTEM_ROLES, can, canAssignSystemRole } from '@/auth/permissions';
import { listUsers } from '@/server/admin';
import { UserRow } from './UserRow';

export const metadata = { title: 'Users · Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const actor = await requireUser('/admin/users');
  const ctx = await authContextFor(actor);
  const users = await listUsers(actor);
  const canManage = can(ctx, 'admin.users.manage');

  // Which roles this actor may grant. The server re-checks on submit; this only decides what to
  // offer, so that the interface does not present a control that would then be refused.
  const assignable = SYSTEM_ROLES.filter((r) => canAssignSystemRole(ctx, r));

  return (
    <>
      <h1 className="text-2xl">Users and roles</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        You may only grant a role below your own, and you cannot change your own role or
        deactivate your own account. Changing a role or deactivating an account ends that user’s
        existing sessions immediately.
      </p>
      {!canManage && (
        <p className="mt-4 max-w-prose rounded border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          You can view this list but not change it — your role carries <code>audit.view</code>{' '}
          without <code>admin.users.manage</code>.
        </p>
      )}

      <ul className="mt-6 flex max-w-4xl flex-col gap-2">
        {users.map((u) => (
          <UserRow
            key={u.id}
            id={u.id}
            email={u.email}
            systemRole={u.systemRole}
            status={u.status}
            lastLoginAt={u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 10) : null}
            projectCount={u._count.memberships}
            assignableRoles={assignable}
            isSelf={u.id === actor.userId}
            canManage={canManage}
          />
        ))}
      </ul>
    </>
  );
}
