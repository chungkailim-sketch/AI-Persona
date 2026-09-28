'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUserApi } from '@/auth/guard';
import { revokeSession } from '@/auth/session';
import { recordAudit } from '@/lib/audit';
import { clientIp } from '@/lib/request';

/**
 * Revoke one of your own sessions.
 *
 * The ownership check is the whole point: the session id comes from the form, so it is
 * attacker-controlled, and `revokeSession` alone would happily revoke anyone's.
 */
export async function revokeSessionAction(formData: FormData): Promise<void> {
  const user = await requireUserApi();
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse({
    sessionId: formData.get('sessionId'),
  });
  if (!parsed.success) return;

  const target = await prisma.session.findUnique({
    where: { id: parsed.data.sessionId },
    select: { id: true, userId: true },
  });
  if (!target || target.userId !== user.userId) return;

  await revokeSession(target.id, 'revoked by user');
  const h = await headers();
  await recordAudit({
    action: 'auth.session.revoked',
    targetType: 'session',
    targetId: target.id,
    actorUserId: user.userId,
    actorEmail: user.email,
    ip: clientIp(h),
  });
  revalidatePath('/settings');
}
