/**
 * Plans and creative briefs the team adds to the report deck (server only). The choice is kept on the
 * Advice row (`options.inReport`); the deck shows them, in the order they were written, after the
 * communications recommendation.
 */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { recordAudit } from '@/lib/audit';
import { JourneyRefused } from '@/roundtable/service';
import type { CommsPlan } from '@/roundtable/schemas';
import type { CreativeBriefContent } from '@/creative/fields';

export type ReportExtra =
  | { id: string; kind: 'COMMS_PLAN'; question: string; content: CommsPlan }
  | { id: string; kind: 'CREATIVE_BRIEF'; question: string; content: CreativeBriefContent };

const KINDS = ['COMMS_PLAN', 'CREATIVE_BRIEF'];

export async function reportExtras(projectId: string): Promise<ReportExtra[]> {
  const rows = await prisma.advice.findMany({
    where: { projectId, kind: { in: KINDS }, status: 'COMPLETED', options: { path: ['inReport'], equals: true } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, question: true, content: true },
  });
  return rows.filter((r) => r.content).map((r) => ({ id: r.id, kind: r.kind, question: r.question, content: r.content }) as unknown as ReportExtra);
}

export async function setInReport(user: SessionUser, projectId: string, adviceId: string, on: boolean): Promise<void> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.edit', projectId)) throw new AuthorizationError('project.edit', projectId);
  const a = await prisma.advice.findFirst({ where: { id: adviceId, projectId, kind: { in: KINDS } }, select: { options: true, status: true, question: true, kind: true } });
  if (!a) throw new JourneyRefused(['That item is not part of this project.']);
  if (on && a.status !== 'COMPLETED') throw new JourneyRefused(['Only finished content can be added to the report.']);
  const options = { ...((a.options ?? {}) as Record<string, unknown>), inReport: on };
  await prisma.advice.update({ where: { id: adviceId }, data: { options } });
  await recordAudit({ action: 'report.content.changed', targetType: 'project', targetId: projectId, projectId, actorUserId: user.userId, actorEmail: user.email, reason: `${on ? 'Added to' : 'Removed from'} the report: ${a.kind === 'CREATIVE_BRIEF' ? 'creative brief' : 'plan'} “${a.question.slice(0, 120)}”` });
}
