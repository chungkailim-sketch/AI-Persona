'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requireUserApi, AuthorizationError } from '@/auth/guard';
import { changeSystemRole, setUserStatus, isSystemRole } from '@/server/admin';
import { clientIp } from '@/lib/request';

export interface AdminActionState {
  error?: string;
  ok?: string;
}

export async function changeRoleAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await requireUserApi();
  const userId = String(formData.get('userId') ?? '');
  const role = String(formData.get('role') ?? '');
  if (!userId || !isSystemRole(role)) return { error: 'Select a valid role.' };

  try {
    const h = await headers();
    await changeSystemRole(actor, userId, role, { ip: clientIp(h) });
    revalidatePath('/admin/users');
    return { ok: 'Role updated. That user’s existing sessions have been ended.' };
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return {
        error:
          'You cannot assign that role. A role may only be granted to someone below your own ' +
          'level, and you cannot change your own role.',
      };
    }
    return { error: e instanceof Error ? e.message : 'That change could not be applied.' };
  }
}

export async function setStatusAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await requireUserApi();
  const userId = String(formData.get('userId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!userId || (status !== 'ACTIVE' && status !== 'DEACTIVATED')) {
    return { error: 'Invalid request.' };
  }

  try {
    const h = await headers();
    await setUserStatus(actor, userId, status, { ip: clientIp(h) });
    revalidatePath('/admin/users');
    return {
      ok:
        status === 'DEACTIVATED'
          ? 'Account deactivated and all its sessions ended.'
          : 'Account reactivated.',
    };
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return { error: 'You cannot change that account.' };
    }
    return { error: e instanceof Error ? e.message : 'That change could not be applied.' };
  }
}
