/**
 * Brief intake (step 2).
 *
 * Three things here are not ordinary form handling.
 *
 * **`desiredOutcome` is captured and withheld.** A brief usually carries what the team is hoping to
 * find. That is useful context for a human reading the report and poison for the simulation: a
 * persona told the desired answer will produce it. The field is stored, shown to people, and
 * excluded from every context assembled for a model (FR-16). The exclusion is enforced by
 * `briefForModelContext()` below, which is the only function the run pipeline may use.
 *
 * **Hypotheses require a falsification threshold.** Each one must state, in advance, what evidence
 * would count as support. Stating it afterwards is how a result becomes a conclusion regardless of
 * what it showed.
 *
 * **Stimulus text is untrusted.** It is pasted from client material and may contain anything,
 * including text shaped like an instruction. It is stored as data and marked as such; nothing
 * downstream may treat it as part of a system prompt.
 */
import { screenStimulusRecord } from '@/judge/checks';
import { prisma } from '@/lib/prisma';
import { can } from '@/auth/permissions';
import { authContextFor, type SessionUser } from '@/auth/session';
import { AuthorizationError } from '@/auth/guard';
import { recordAudit } from '@/lib/audit';

export interface BriefInput {
  businessContext?: string;
  researchQuestion: string;
  objective: string;
  decisionSupported: string;
  targetAudience?: string;
  markets: string[];
  timePeriod?: string;
  competitors: string[];
  /** Captured for the report, withheld from every model context. */
  desiredOutcome?: string;
  constraints?: string;
  exclusions: string[];
  prohibitedInferences: string[];
  personaCount: number;
  runCount: number;
  simulationDepth: 'quick' | 'standard' | 'deep';
  confidenceRequirement?: string;
  reportAudience?: string;
}

export interface HypothesisInput {
  label: string;
  statement: string;
  operationalDefinition?: string;
  nullHypothesis?: string;
  /** What evidence would count as support — decided before the result is seen. */
  minimumEvidenceThreshold: string;
  alternativeExplanations: string[];
}

export interface StimulusInput {
  label: string;
  name: string;
  content: string;
}

export class BriefRefused extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'BriefRefused';
  }
}

async function requireEdit(user: SessionUser, projectId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.edit', projectId)) throw new AuthorizationError('project.edit', projectId);
  return ctx;
}

export async function getOrCreateBrief(user: SessionUser, projectId: string) {
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) throw new AuthorizationError('project.view', projectId);

  const existing = await prisma.brief.findFirst({
    where: { projectId },
    orderBy: { versionNo: 'desc' },
    include: { hypotheses: { orderBy: { createdAt: 'asc' } }, stimuli: { orderBy: { createdAt: 'asc' } } },
  });
  if (existing) return existing;

  if (!can(ctx, 'project.edit', projectId)) return null;

  return prisma.brief.create({
    data: { projectId, versionNo: 1, createdById: user.userId },
    include: { hypotheses: true, stimuli: true },
  });
}

export async function saveBrief(
  user: SessionUser,
  projectId: string,
  briefId: string,
  input: BriefInput,
  meta: { ip?: string | null } = {},
): Promise<void> {
  await requireEdit(user, projectId);

  const brief = await prisma.brief.findFirst({ where: { id: briefId, projectId } });
  if (!brief) throw new AuthorizationError('project.edit', projectId);
  if (brief.status === 'LOCKED') {
    throw new BriefRefused([
      'This brief is locked because a run has used it. Create a new version to change it — ' +
        'editing it in place would change what a completed run claims to have tested.',
    ]);
  }

  const problems: string[] = [];
  if (input.researchQuestion.trim().length < 15) {
    problems.push('State the research question in a sentence of at least 15 characters.');
  }
  if (input.decisionSupported.trim().length < 15) {
    problems.push(
      'State the decision this run should inform. A run with no decision behind it has no way to ' +
        'be judged useful or useless.',
    );
  }
  if (input.markets.length === 0) problems.push('Name at least one market.');
  if (input.personaCount < 3 || input.personaCount > 60) {
    problems.push('The cohort must be between 3 and 60 personas.');
  }
  if (input.runCount < 1 || input.runCount > 10) problems.push('Runs must be between 1 and 10.');
  if (problems.length > 0) throw new BriefRefused(problems);

  await prisma.brief.update({
    where: { id: briefId },
    data: {
      businessContext: input.businessContext?.trim() || null,
      researchQuestion: input.researchQuestion.trim(),
      objective: input.objective.trim(),
      decisionSupported: input.decisionSupported.trim(),
      targetAudience: input.targetAudience?.trim() || null,
      markets: input.markets,
      timePeriod: input.timePeriod?.trim() || null,
      competitors: input.competitors,
      desiredOutcome: input.desiredOutcome?.trim() || null,
      constraints: input.constraints?.trim() || null,
      exclusions: input.exclusions,
      prohibitedInferences: input.prohibitedInferences,
      personaCount: input.personaCount,
      runCount: input.runCount,
      simulationDepth: input.simulationDepth,
      confidenceRequirement: input.confidenceRequirement?.trim() || null,
      reportAudience: input.reportAudience?.trim() || null,
      status: 'DRAFT',
    },
  });

  await recordAudit({
    action: 'brief.saved',
    targetType: 'brief',
    targetId: briefId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    // The desired outcome is deliberately not copied into the audit value; it is stored once, on
    // the brief, and read only where a person will see it.
    afterValue: { markets: input.markets, personaCount: input.personaCount, runCount: input.runCount },
    ip: meta.ip ?? null,
  });
}

export async function addHypothesis(
  user: SessionUser,
  projectId: string,
  briefId: string,
  input: HypothesisInput,
  meta: { ip?: string | null } = {},
): Promise<{ id: string }> {
  await requireEdit(user, projectId);
  const brief = await prisma.brief.findFirst({ where: { id: briefId, projectId } });
  if (!brief) throw new AuthorizationError('project.edit', projectId);

  const problems: string[] = [];
  if (input.statement.trim().length < 15) {
    problems.push('State the hypothesis as a claim that could turn out to be false.');
  }
  if (input.minimumEvidenceThreshold.trim().length < 20) {
    problems.push(
      'State what evidence would count as support, before the result is seen. Deciding afterwards ' +
        'is how any result becomes confirmation.',
    );
  }
  if (problems.length > 0) throw new BriefRefused(problems);

  const created = await prisma.hypothesis.create({
    data: {
      briefId,
      label: input.label.trim() || 'H',
      statement: input.statement.trim(),
      operationalDefinition: input.operationalDefinition?.trim() || null,
      nullHypothesis: input.nullHypothesis?.trim() || null,
      minimumEvidenceThreshold: input.minimumEvidenceThreshold.trim(),
      alternativeExplanations: input.alternativeExplanations.filter((a) => a.trim() !== ''),
    },
    select: { id: true, label: true },
  });

  await recordAudit({
    action: 'hypothesis.added',
    targetType: 'hypothesis',
    targetId: created.id,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: { label: created.label, threshold: input.minimumEvidenceThreshold.trim() },
    ip: meta.ip ?? null,
  });

  return { id: created.id };
}

export async function removeHypothesis(
  user: SessionUser,
  projectId: string,
  hypothesisId: string,
  meta: { ip?: string | null } = {},
): Promise<void> {
  await requireEdit(user, projectId);
  const h = await prisma.hypothesis.findFirst({
    where: { id: hypothesisId, brief: { projectId } },
    include: { brief: { select: { status: true } } },
  });
  if (!h) throw new AuthorizationError('project.edit', projectId);
  if (h.brief.status === 'LOCKED') {
    throw new BriefRefused([
      'This brief is locked because a run has used it. Removing a hypothesis now would change ' +
        'what that run reports having tested.',
    ]);
  }

  await prisma.hypothesis.delete({ where: { id: hypothesisId } });
  await recordAudit({
    action: 'hypothesis.removed',
    targetType: 'hypothesis',
    targetId: hypothesisId,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    beforeValue: { label: h.label, statement: h.statement },
    ip: meta.ip ?? null,
  });
}

export async function addStimulus(
  user: SessionUser,
  projectId: string,
  briefId: string,
  input: StimulusInput,
  meta: { ip?: string | null } = {},
): Promise<{ id: string }> {
  await requireEdit(user, projectId);
  const brief = await prisma.brief.findFirst({ where: { id: briefId, projectId } });
  if (!brief) throw new AuthorizationError('project.edit', projectId);

  if (input.content.trim().length === 0) {
    throw new BriefRefused(['The stimulus has no content.']);
  }
  if (input.content.length > 20_000) {
    throw new BriefRefused(['A stimulus is limited to 20,000 characters.']);
  }

  const created = await prisma.stimulus.create({
    data: {
      briefId,
      label: input.label.trim() || 'Variant',
      name: input.name.trim() || 'Untitled',
      // Stored verbatim as data. It is wrapped as untrusted content wherever it reaches a model.
      content: input.content,
      format: 'text',
    },
    select: { id: true },
  });

  // Advisory: a stimulus that addresses the evaluator is flagged for the author, not refused. It is
  // wrapped as untrusted content wherever it reaches a model regardless.
  await screenStimulusRecord(projectId, created.id, input.content);

  await recordAudit({
    action: 'stimulus.added',
    targetType: 'stimulus',
    targetId: created.id,
    projectId,
    actorUserId: user.userId,
    actorEmail: user.email,
    afterValue: { label: input.label, name: input.name, chars: input.content.length },
    ip: meta.ip ?? null,
  });

  return { id: created.id };
}

/** What a brief still needs before a run can be configured. */
export interface BriefReadiness {
  ready: boolean;
  missing: string[];
}

export async function assessBrief(projectId: string): Promise<BriefReadiness> {
  const brief = await prisma.brief.findFirst({
    where: { projectId },
    orderBy: { versionNo: 'desc' },
    include: { hypotheses: true, stimuli: true },
  });
  if (!brief) return { ready: false, missing: ['No brief has been started.'] };

  const missing: string[] = [];
  if (!brief.researchQuestion) missing.push('The research question is not stated.');
  if (!brief.decisionSupported) missing.push('The decision this run informs is not stated.');
  if (brief.markets.length === 0) missing.push('No market is named.');
  if (brief.hypotheses.length === 0) {
    missing.push('No hypothesis has been stated, so there is nothing for the run to test.');
  }
  const withoutThreshold = brief.hypotheses.filter(
    (h) => h.minimumEvidenceThreshold.trim().length < 20,
  );
  if (withoutThreshold.length > 0) {
    missing.push(
      `${withoutThreshold.length} hypothesis(es) have no usable evidence threshold stated in advance.`,
    );
  }

  return { ready: missing.length === 0, missing };
}

/**
 * The brief as the run pipeline may see it.
 *
 * This is the ONLY function that assembles brief content for a model. `desiredOutcome` is absent by
 * construction rather than by a filter that could be forgotten — the returned object simply has no
 * such property, so a future caller cannot pass it along by accident.
 */
export interface BriefModelContext {
  researchQuestion: string;
  objective: string;
  decisionSupported: string;
  targetAudience: string | null;
  markets: string[];
  timePeriod: string | null;
  competitors: string[];
  constraints: string | null;
  exclusions: string[];
  prohibitedInferences: string[];
  hypotheses: {
    id: string;
    label: string;
    statement: string;
    operationalDefinition: string | null;
    nullHypothesis: string | null;
    alternativeExplanations: string[];
  }[];
  /** Stimulus content, explicitly marked as untrusted material rather than instruction. */
  stimuli: { label: string; name: string; untrustedContent: string }[];
}

export async function briefForModelContext(briefId: string): Promise<BriefModelContext | null> {
  const brief = await prisma.brief.findUnique({
    where: { id: briefId },
    include: { hypotheses: { orderBy: { createdAt: 'asc' } }, stimuli: { orderBy: { createdAt: 'asc' } } },
  });
  if (!brief) return null;

  return {
    researchQuestion: brief.researchQuestion ?? '',
    objective: brief.objective ?? '',
    decisionSupported: brief.decisionSupported ?? '',
    targetAudience: brief.targetAudience,
    markets: brief.markets,
    timePeriod: brief.timePeriod,
    competitors: brief.competitors,
    constraints: brief.constraints,
    exclusions: brief.exclusions,
    prohibitedInferences: brief.prohibitedInferences,
    hypotheses: brief.hypotheses.map((h) => ({
      id: h.id,
      label: h.label,
      statement: h.statement,
      operationalDefinition: h.operationalDefinition,
      nullHypothesis: h.nullHypothesis,
      alternativeExplanations: h.alternativeExplanations,
      // The threshold is deliberately absent too: a persona that knows what would count as support
      // is being told what to produce.
    })),
    stimuli: brief.stimuli.map((s) => ({
      label: s.label,
      name: s.name,
      untrustedContent: s.content,
    })),
  };
}

export const DESIRED_OUTCOME_NOTICE =
  'Recorded for the report and deliberately withheld from the simulation. A persona that knows ' +
  'what you are hoping to find will tend to produce it, which would make the result worthless.';
