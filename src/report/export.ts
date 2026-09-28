/**
 * Export.
 *
 * The rule this module exists to enforce: **nothing leaves the application with a claim the claim
 * checker blocked.** An export is the moment a simulation stops being a thing a careful person is
 * looking at and becomes a document someone forwards, and a document travels without its context.
 *
 * So an export is either produced with its limitations attached, or it is refused with the reasons
 * given. There is no third path, and no option anywhere that turns the caveats off — `ReportExport`
 * records a blocked attempt as a row with its reason rather than quietly producing nothing.
 *
 * A reviewer may acknowledge a block and export anyway. That is deliberate: a mechanical checker
 * will sometimes be wrong, and a control nobody can ever override becomes a control people route
 * around. But the override is named, recorded and carried in the exported file itself.
 */
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { recordAudit } from '@/lib/audit';
import { assembleReport, renderMarkdown, type AssembledReport } from '@/report/assemble';
import { checkClaim, type ClaimIssue } from '@/report/claimCheck';

export type ExportFormat = 'markdown' | 'json';

export class ExportBlocked extends Error {
  constructor(
    readonly issues: { claim: string; issues: ClaimIssue[] }[],
  ) {
    super('This report contains claims the check refused.');
    this.name = 'ExportBlocked';
  }
}

export interface ExportResult {
  format: ExportFormat;
  filename: string;
  content: string;
  contentType: string;
  /** Present when a reviewer overrode a block. Carried into the file itself. */
  overrideNote: string | null;
}

/** Run the checker over everything in a report that makes a claim. */
export function checkReport(report: AssembledReport): { claim: string; issues: ClaimIssue[] }[] {
  const subjects: string[] = [
    report.headline,
    report.directAnswer,
    report.qualifiedRecommendation,
    ...report.findings.map((f) => f.claim),
    ...report.findings.map((f) => f.title),
  ].filter((s) => s.trim().length > 0);

  const out: { claim: string; issues: ClaimIssue[] }[] = [];
  for (const claim of subjects) {
    const result = checkClaim({
      claim,
      evidenceFigures: report.evidenceFigures,
      evidenceGrade: report.findings[0]?.evidenceGrade ?? 'L3_PERSONA_SIMULATION',
      panelSize: report.panelSize,
      isMock: report.isMock,
    });
    if (result.issues.length > 0) out.push({ claim, issues: result.issues });
  }
  return out;
}

function blockingOnly(
  checked: { claim: string; issues: ClaimIssue[] }[],
): { claim: string; issues: ClaimIssue[] }[] {
  return checked
    .map((c) => ({ claim: c.claim, issues: c.issues.filter((i) => i.severity === 'blocking') }))
    .filter((c) => c.issues.length > 0);
}

export async function exportReport(
  user: SessionUser,
  projectId: string,
  runId: string,
  format: ExportFormat,
  options: { acknowledgeBlocks?: string } = {},
): Promise<ExportResult> {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'report.export', projectId)) {
    throw new AuthorizationError('report.export', projectId);
  }

  const report = await assembleReport(user, projectId, runId);
  const checked = checkReport(report);
  const blocked = blockingOnly(checked);

  const acknowledgement = options.acknowledgeBlocks?.trim() ?? '';
  const overriding = blocked.length > 0 && acknowledgement.length >= 30;

  if (blocked.length > 0 && !overriding) {
    // Recorded as a blocked attempt rather than silently failing: a refusal nobody can see is a
    // refusal nobody learns from.
    await prisma.reportExport.create({
      data: {
        runId,
        format,
        blocked: true,
        blockReason: blocked
          .flatMap((b) => b.issues.map((i) => `${i.kind}: ${i.excerpt}`))
          .join('; ')
          .slice(0, 1000),
        createdById: user.userId,
      },
    });
    await recordAudit({
      action: 'report.export.blocked',
      targetType: 'run',
      targetId: runId,
      projectId,
      actorUserId: user.userId,
      actorEmail: user.email,
      afterValue: { format, blockedClaims: blocked.length },
    });
    throw new ExportBlocked(blocked);
  }

  const overrideNote = overriding
    ? `Exported over ${blocked.length} blocked claim(s) by ${user.email}: ${acknowledgement}`
    : null;

  const content =
    format === 'markdown'
      ? renderMarkdownWithOverride(report, overrideNote, checked)
      : JSON.stringify(
          {
            ...report,
            claimCheck: checked,
            override: overrideNote,
            notice:
              'Simulated output. Not evidence of real behaviour. The limitations array is part of ' +
              'this document and is not optional.',
          },
          null,
          2,
        );

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = report.projectName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();

  await prisma.reportExport.create({
    data: {
      runId,
      format,
      blocked: false,
      blockReason: overrideNote,
      reviewerAckById: overriding ? user.userId : null,
      reviewerAckAt: overriding ? new Date() : null,
      createdById: user.userId,
    },
  });

  await recordAudit({
    action: overriding ? 'report.export.overridden' : 'report.exported',
    targetType: 'run',
    targetId: runId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: { format, overridden: overriding, warnings: checked.length },
    reason: overrideNote ?? undefined,
  });

  return {
    format,
    filename: `${safeName}-${stamp}.${format === 'markdown' ? 'md' : 'json'}`,
    content,
    contentType: format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json',
    overrideNote,
  };
}

/**
 * The override is written into the top of the document, not just into the audit log.
 *
 * Someone reading the exported file two months later has no access to the audit log, and the fact
 * that a check was overridden is exactly what they need to know.
 */
function renderMarkdownWithOverride(
  report: AssembledReport,
  overrideNote: string | null,
  checked: { claim: string; issues: ClaimIssue[] }[],
): string {
  const base = renderMarkdown(report);
  if (!overrideNote) {
    const warnings = checked.flatMap((c) => c.issues.filter((i) => i.severity === 'warning'));
    if (warnings.length === 0) return base;
    return [
      base,
      '',
      '## Notes from the claim check',
      '',
      ...warnings.map((w) => `- **${w.kind.replace(/_/g, ' ')}** ("${w.excerpt}"): ${w.message}`),
    ].join('\n');
  }

  return [
    '> **The unsupported-claim check was overridden for this export.**',
    `> ${overrideNote}`,
    '>',
    '> The claims flagged below were exported despite being refused. Read them with that in mind.',
    '',
    ...checked.flatMap((c) => [
      `> - "${c.claim.slice(0, 120)}${c.claim.length > 120 ? '…' : ''}"`,
      ...c.issues.map((i) => `>   - ${i.kind.replace(/_/g, ' ')}: ${i.message}`),
    ]),
    '',
    base,
  ].join('\n');
}

export async function listExports(user: SessionUser, projectId: string, runId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'report.view', projectId)) throw new AuthorizationError('report.view', projectId);

  return prisma.reportExport.findMany({
    where: { runId, run: { projectId } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

/** Minimum length of an override justification. A word is not a reason. */
export const OVERRIDE_MINIMUM = 30;
