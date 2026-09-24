/**
 * Audit trail (SEC-06, NFR-21).
 *
 * Append-only. There is no update or delete path for an AuditEvent anywhere in the codebase — a
 * correction is a new event that references the old one, never a rewrite of history.
 *
 * Two constraints are enforced here rather than left to callers:
 *  1. No raw IP address is stored. Callers pass the request; this module hashes with a server-side
 *     pepper (NFR-19).
 *  2. Writing an audit event must never fail the operation it describes. A failure to record is
 *     logged to the server and swallowed, because losing the user's work to protect the log would
 *     be the wrong trade — but the failure is visible in the server log so it can be investigated.
 */
import { prisma } from '@/lib/prisma';
import { hashIp } from '@/auth/otp';
import { env } from '@/lib/env';

/** Canonical action names. A string union rather than free text so the admin log can filter. */
export const AUDIT_ACTIONS = [
  'auth.code.requested',
  'auth.code.request_refused',
  'auth.code.verified',
  'auth.code.failed',
  'auth.session.created',
  'auth.session.revoked',
  'auth.signout',
  'authz.denied',
  'user.created',
  'user.role.changed',
  'user.deactivated',
  'domain.added',
  'domain.removed',
  'project.created',
  'project.step.advanced',
  'dataset.uploaded',
  'dataset.version.created',
  'dataset.ingest.completed',
  'dataset.ingest.failed',
  'dataset.field.review.confirmed',
  'dataset.finding.acknowledged',
  'dataset.trend.requested',
  'population.sample.built',
  'governance.recorded',
  'governance.model_processing.granted',
  'governance.model_processing.withdrawn',
  'persona.cohort.generated',
  'persona.cohort.approved',
  'run.created',
  'run.confirmed',
  'run.started',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.budget.exceeded',
  'report.exported',
  'report.export.blocked',
  'report.export.overridden',
  'brief.saved',
  'brief.submitted',
  'hypothesis.added',
  'hypothesis.removed',
  'stimulus.added',
  'project.member.added',
  'project.member.role.changed',
  'project.member.removed',
  'breakglass.granted',
  'breakglass.used',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditInput {
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  projectId?: string | null;
  reason?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
  correlationId?: string | null;
  /** Raw address. Hashed here; never persisted in the clear. */
  ip?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorEmail: input.actorEmail ?? null,
        projectId: input.projectId ?? null,
        reason: input.reason ?? null,
        beforeValue: input.beforeValue === undefined ? undefined : (input.beforeValue as object),
        afterValue: input.afterValue === undefined ? undefined : (input.afterValue as object),
        correlationId: input.correlationId ?? null,
        ipHash: input.ip ? hashIp(input.ip, env().IP_HASH_PEPPER) : null,
      },
    });
  } catch (e) {
    console.error('[audit] failed to record event', {
      action: input.action,
      targetType: input.targetType,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
