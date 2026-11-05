'use server';

import { revalidatePath } from 'next/cache';
import { requireUserApi } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { enqueue } from '@/queue/queue';
import { prisma } from '@/lib/prisma';
import { decisionsConfigured, env } from '@/lib/env';

export interface HeadshotActionState {
  error?: string;
  ok?: string;
}

export async function generateHeadshotsAction(_prev: HeadshotActionState, formData: FormData): Promise<HeadshotActionState> {
  const actor = await requireUserApi();
  const ctx = await authContextFor(actor);
  if (!can(ctx, 'admin.models.manage')) return { error: 'You cannot manage models.' };
  if (!decisionsConfigured(env())) return { error: 'No OpenAI key is set. Add OPENAI_API_KEY in Railway → Variables (web and worker), then try again.' };
  const running = await prisma.job.findFirst({ where: { kind: 'headshots', status: { in: ['PENDING', 'RUNNING'] } }, select: { id: true } });
  if (running) return { error: 'Headshots are already being generated.' };
  const force = formData.get('force') === 'on';
  await enqueue({ kind: 'headshots', input: { force }, idempotencyKey: `headshots:${Date.now()}`, maxAttempts: 1 });
  revalidatePath('/admin/headshots');
  return { ok: 'Started. Fifty portraits take a few minutes; reload this page to see progress.' };
}
