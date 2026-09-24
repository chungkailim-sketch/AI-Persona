'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requireUserApi, AuthorizationError } from '@/auth/guard';
import { addDomain, setDomainActive } from '@/server/admin';
import { clientIp } from '@/lib/request';

export interface DomainActionState {
  error?: string;
  ok?: string;
}

export async function addDomainAction(
  _prev: DomainActionState,
  formData: FormData,
): Promise<DomainActionState> {
  const actor = await requireUserApi();
  const domain = String(formData.get('domain') ?? '');
  try {
    const h = await headers();
    await addDomain(actor, domain, { ip: clientIp(h) });
    revalidatePath('/admin/domains');
    return { ok: `${domain.trim().toLowerCase()} may now receive sign-in codes.` };
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: 'You cannot manage approved domains.' };
    return { error: e instanceof Error ? e.message : 'That domain could not be added.' };
  }
}

export async function toggleDomainAction(formData: FormData): Promise<void> {
  const actor = await requireUserApi();
  const domain = String(formData.get('domain') ?? '');
  const active = String(formData.get('active') ?? '') === 'true';
  if (!domain) return;
  const h = await headers();
  await setDomainActive(actor, domain, active, { ip: clientIp(h) });
  revalidatePath('/admin/domains');
}
