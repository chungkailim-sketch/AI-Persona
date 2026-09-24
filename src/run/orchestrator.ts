/**
 * The run orchestrator.
 *
 * A deterministic state machine, not an agent framework. Every stage is a named step with a
 * recorded start, end, duration and outcome, and the sequence is fixed. That choice is deliberate:
 * a run that must be reproducible, auditable and explainable cannot be a loop whose shape depends
 * on what a model decided to do next.
 *
 * What determinism means here: the same plan hash and the same seeds produce the same sequence of
 * requests, the same per-persona seeds, and — with the mock provider — the same answers. With a
 * live provider the answers vary, but everything *around* them is identical and recorded.
 *
 * The order of the stages carries the method:
 *
 *   1 PREPARING_CONTEXT      assemble evidence; refuse if the gate is not satisfied
 *   2 GENERATING_PERSONAS    bind the approved cohort to this run
 *   3 INDEPENDENT_ASSESSMENT every persona answers ALONE — nobody sees another view
 *   4 CONSUMER_REACTION      reactions to the stimulus, still in isolation
 *   5 CROSS_EXAMINATION      at least half the panel must challenge the prevailing view
 *   6 REVISION               each persona revisits its position having seen the challenges
 *   7 SYNTHESIS              findings assembled with dissent and anti-herding metrics attached
 *   8 REPORT                 persisted for reading and export
 *
 * Stage 3 being isolated is the whole reason the anti-herding numbers mean anything: agreement
 * measured after exposure tells you only that exposure happened.
 */
import { checkStances } from '@/judge/checks';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/lib/audit';
import { buildEvidenceContext, renderEvidence, wrapUntrusted, EvidenceRefused } from '@/model/context';
import { briefForModelContext, type BriefModelContext } from '@/server/brief';
import { callModel, BudgetExceeded, runSpendUsd, modelProvider } from '@/model/client';
import { runTelemetry } from '@/run/telemetry';
import { deriveSeed } from '@/model/provider';
import {
  ConsumerReaction,
  CrossExamination,
  IndependentAssessment,
  Revision,
  SynthesisOutput,
  type Stance,
} from '@/run/schemas';
import { measureAntiHerd, requiredChallengers } from '@/run/antiHerd';

export const PROMPT_VERSION = '1.0.0';

export const RUN_STAGES = [
  'PREPARING_CONTEXT',
  'GENERATING_PERSONAS',
  'INDEPENDENT_ASSESSMENT',
  'CONSUMER_REACTION',
  'CROSS_EXAMINATION',
  'REVISION',
  'SYNTHESIS',
  'REPORT',
] as const;
export type RunStage = (typeof RUN_STAGES)[number];

export class RunRefused extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join(' '));
    this.name = 'RunRefused';
  }
}

/**
 * The plan hash.
 *
 * Identifies everything that decides what a run will do: the cohort, the evidence, the brief, the
 * model, the seeds and the prompt version. Two runs with the same plan hash asked the same
 * question of the same material in the same way — which is what makes "run it again and see" a
 * meaningful instruction.
 */
export function computePlanHash(input: {
  cohortId: string;
  datasetVersionIds: string[];
  briefId: string;
  modelId: string;
  seeds: number[];
  promptVersion: string;
  stimulusIds: string[];
}): string {
  const canonical = JSON.stringify({
    cohortId: input.cohortId,
    datasetVersionIds: [...input.datasetVersionIds].sort(),
    briefId: input.briefId,
    modelId: input.modelId,
    seeds: input.seeds,
    promptVersion: input.promptVersion,
    stimulusIds: [...input.stimulusIds].sort(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// ── Prompt construction ───────────────────────────────────────────────────────

/**
 * The system prompt shared by every persona turn.
 *
 * Four instructions carry most of the weight. They exist because the failure modes they address are
 * the ones that make a simulation actively misleading rather than merely uninformative.
 */
export function personaSystem(persona: PersonaForRun, evidence: string, brief: BriefModelContext): string {
  const attributes = persona.attributes
    .map((a) => `- [${a.origin.toLowerCase()}] ${a.label}: ${a.value}${a.baseSize ? ` (base ${a.baseSize})` : ''}`)
    .join('\n');

  return [
    'You are answering as a described segment of survey respondents, not as an individual person',
    'and not as an assistant. Your answers are a simulation used for decision support; they are not',
    'evidence of what any real person thinks.',
    '',
    `## Who you represent`,
    persona.summary,
    persona.coverageNote ? `\nImportant: ${persona.coverageNote}` : '',
    '',
    '## What is known about this segment',
    'Each attribute is tagged with where it came from. "observed" was measured. "derived" was',
    'computed from measurements. "simulated" was generated and measures nothing.',
    attributes,
    '',
    evidence,
    '',
    '## How to answer',
    '1. Ground every claim in the evidence above. If the evidence does not address something, say',
    '   so — "the evidence does not show this" is a complete and correct answer.',
    '2. Never invent a figure, a brand, a competitor or a demographic that is not above.',
    '3. Disagree when you have reason to. A panel that agrees because agreeing is easy is useless,',
    '   and your disagreement is recorded as a finding in its own right.',
    '4. Your confidence should reflect the evidence, not your fluency. A small base or a weakly',
    '   mapped construct means low confidence, however clearly you can express the answer.',
    brief.prohibitedInferences.length > 0
      ? `\n## Inferences you must not draw\n${brief.prohibitedInferences.map((p) => `- ${p}`).join('\n')}`
      : '',
    brief.exclusions.length > 0
      ? `\n## Out of scope\n${brief.exclusions.map((e) => `- ${e}`).join('\n')}`
      : '',
    '',
    'Reply with a single JSON object matching the requested shape. No prose outside it.',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface PersonaForRun {
  id: string;
  versionId: string;
  key: string;
  name: string;
  summary: string;
  segment: string | null;
  coverageNote: string | null;
  confidence: string;
  baseSize: number | null;
  attributes: { label: string; value: string; origin: string; baseSize: number | null }[];
}

// ── Execution ─────────────────────────────────────────────────────────────────

export interface RunOutcome {
  runId: string;
  status: 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED' | 'CANCELLED';
  isMock: boolean;
  spendUsd: number;
  findings: number;
  warnings: string[];
}

interface StageRecorder {
  begin(stage: RunStage, total?: number | null): Promise<string>;
  finish(stepId: string, status: 'completed' | 'failed' | 'skipped', output?: unknown, error?: string): Promise<void>;
}

type Telemetry = ReturnType<typeof runTelemetry>;

const STAGE_MESSAGE: Record<RunStage, string> = {
  PREPARING_CONTEXT: 'Assembling evidence behind the governance gate.',
  GENERATING_PERSONAS: 'Binding the approved cohort to this run.',
  INDEPENDENT_ASSESSMENT: 'Each persona answers alone.',
  CONSUMER_REACTION: 'Reactions to the stimulus, still in isolation.',
  CROSS_EXAMINATION: 'Challengers argue against the prevailing view.',
  REVISION: 'Each persona reconsiders its position.',
  SYNTHESIS: 'Computing the distribution, dissent and anti-herding metrics.',
  REPORT: 'Persisting the synthesis and limitations.',
};

function recorder(runId: string, t: Telemetry): StageRecorder {
  let sequence = 0;
  return {
    async begin(stage, total) {
      sequence += 1;
      const step = await prisma.runStep.create({
        data: { runId, stage, sequence, status: 'running', startedAt: new Date() },
      });
      await prisma.run.update({ where: { id: runId }, data: { status: stage } });
      await t.stage(stage, 'active', STAGE_MESSAGE[stage], {
        progressCurrent: total ? 0 : null,
        progressTotal: total ?? null,
      });
      return step.id;
    },
    async finish(stepId, status, output, error) {
      const step = await prisma.runStep.findUniqueOrThrow({ where: { id: stepId } });
      const stage = step.stage as RunStage;
      await t.stage(
        stage,
        status === 'skipped' ? 'skipped' : status,
        status === 'completed'
          ? `${stage.toLowerCase().replace(/_/g, ' ')} completed.`
          : status === 'skipped'
            ? `${stage.toLowerCase().replace(/_/g, ' ')} skipped${error ? ` — ${error}` : (output as { reason?: string } | undefined)?.reason ? ` — ${(output as { reason: string }).reason}` : ''}.`
            : `${stage.toLowerCase().replace(/_/g, ' ')} failed${error ? `: ${error}` : ''}.`,
        { severity: status === 'failed' ? 'error' : 'info' },
      );
      await prisma.runStep.update({
        where: { id: stepId },
        data: {
          status,
          completedAt: new Date(),
          durationMs: step.startedAt ? Date.now() - step.startedAt.getTime() : null,
          outputRef: (output ?? undefined) as object | undefined,
          errorMessage: error?.slice(0, 1000) ?? null,
        },
      });
    },
  };
}

/** Cancellation is cooperative: checked between stages and between personas within a stage. */
async function cancelRequested(runId: string): Promise<boolean> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { cancelRequested: true },
  });
  return run?.cancelRequested ?? false;
}

export async function executeRun(runId: string): Promise<RunOutcome> {
  const warnings: string[] = [];

  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      config: { include: { datasets: true, cohort: true } },
      brief: true,
    },
  });
  if (!run) throw new Error(`Run ${runId} does not exist.`);
  if (!run.config) throw new RunRefused(['This run has no configuration.']);
  if (!run.config.confirmedAt) {
    throw new RunRefused([
      'This run was never confirmed. A run must be explicitly confirmed by a person before any ' +
        'model call is made.',
    ]);
  }

  const config = run.config;
  const t = runTelemetry(runId, run.projectId, modelProvider().name === 'mock');
  const step = recorder(runId, t);
  const warn = async (message: string) => {
    warnings.push(message);
    await t.send({ eventType: 'run.warning', stage: 'run', status: 'warning', severity: 'warning', message });
  };
  const seed = config.seeds[0] ?? 42;
  const budgetCapUsd = config.budgetCapUsd ?? undefined;

  await prisma.run.update({
    where: { id: runId },
    data: { startedAt: new Date(), status: 'PREPARING_CONTEXT' },
  });
  await t.send({
    eventType: 'run.started',
    stage: 'run',
    status: 'active',
    message: `Run started on the ${modelProvider().name} provider.`,
  });

  try {
    // ── 1. Context ───────────────────────────────────────────────────────────
    let stepId = await step.begin('PREPARING_CONTEXT');

    const datasetVersionIds = config.datasets.map((d) => d.datasetVersionId);
    if (datasetVersionIds.length === 0) {
      await step.finish(stepId, 'failed', undefined, 'No dataset attached.');
      throw new RunRefused(['No dataset is attached to this run.']);
    }

    // Refuses when the governance gate is not satisfied. Deliberately fatal.
    const contexts = await Promise.all(datasetVersionIds.map((id) => buildEvidenceContext(id)));
    const evidenceText = contexts.map(renderEvidence).join('\n\n');
    const manifestHash = createHash('sha256')
      .update(contexts.map((c) => c.manifestHash).join('|'))
      .digest('hex');

    if (!run.briefId) {
      await step.finish(stepId, 'failed', undefined, 'No brief attached.');
      throw new RunRefused(['No brief is attached to this run.']);
    }
    const brief = await briefForModelContext(run.briefId);
    if (!brief) {
      await step.finish(stepId, 'failed', undefined, 'The brief could not be read.');
      throw new RunRefused(['The brief attached to this run could not be read.']);
    }
    if (brief.hypotheses.length === 0) {
      await step.finish(stepId, 'failed', undefined, 'No hypothesis.');
      throw new RunRefused(['The brief states no hypothesis, so there is nothing to test.']);
    }

    await step.finish(stepId, 'completed', {
      datasets: datasetVersionIds.length,
      fields: contexts.reduce((s, c) => s + c.fields.length, 0),
      manifestHash,
    });

    // ── 2. Personas ──────────────────────────────────────────────────────────
    stepId = await step.begin('GENERATING_PERSONAS');
    if (!config.cohortId) {
      await step.finish(stepId, 'failed', undefined, 'No cohort.');
      throw new RunRefused(['No cohort is attached to this run.']);
    }

    const personaRows = await prisma.persona.findMany({
      where: { cohortId: config.cohortId },
      include: {
        versions: {
          where: { approval: 'APPROVED', enabled: true },
          orderBy: { versionNo: 'desc' },
          take: 1,
          include: { attributes: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const personas: PersonaForRun[] = personaRows
      .filter((p) => p.versions.length > 0)
      .map((p) => {
        const v = p.versions[0]!;
        return {
          id: p.id,
          versionId: v.id,
          key: p.name,
          name: p.name,
          summary: v.summary ?? p.name,
          segment: v.segment,
          coverageNote: v.coverageNote,
          confidence: v.confidence,
          baseSize: v.baseSize,
          attributes: v.attributes.map((a) => ({
            label: a.label,
            value: a.value,
            origin: a.origin,
            baseSize: a.baseSize,
          })),
        };
      });

    if (personas.length === 0) {
      await step.finish(stepId, 'failed', undefined, 'No approved personas.');
      throw new RunRefused([
        'The cohort has no approved personas. A cohort must be approved before a run can use it.',
      ]);
    }
    await step.finish(stepId, 'completed', { personas: personas.length });

    const hypothesis = brief.hypotheses[0]!;
    const stimulus = brief.stimuli[0];

    // ── 3. Independent assessment — the isolated round ───────────────────────
    stepId = await step.begin('INDEPENDENT_ASSESSMENT', personas.length);
    const independent = new Map<string, IndependentAssessment>();
    let n = 0;

    for (const persona of personas) {
      if (await cancelRequested(runId)) {
        await step.finish(stepId, 'skipped', undefined, 'Cancelled.');
        return await finishCancelled(runId, warnings, t);
      }
      n += 1;
      const idx = n;

      // Nothing from any other persona is in this prompt. That isolation is what makes the
      // independent-agreement figure mean anything at all.
      const result = await callModel({
        runId,
        stage: 'INDEPENDENT_ASSESSMENT',
        personaKey: persona.key,
        system: personaSystem(persona, evidenceText, brief),
        messages: [
          {
            role: 'user',
            content: [
              `The question: ${brief.researchQuestion}`,
              '',
              `The claim to assess: ${hypothesis.statement}`,
              hypothesis.operationalDefinition
                ? `How it is measured: ${hypothesis.operationalDefinition}`
                : '',
              '',
              'Answer alone. You have not seen anyone else\'s view, and you should not guess at one.',
              'Respond with JSON: { "stance": "confirm" | "dispute" | "abstain", "confidence":',
              '0..1, "rationale": string, "evidenceCited": string[], "uncertainties": string[] }',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        schemaName: 'independent_assessment',
        schema: IndependentAssessment,
        seed: deriveSeed(seed, 'independent', persona.key),
        evidenceManifestHash: manifestHash,
        budgetCapUsd,
        promptTemplate: 'persona.independent',
        promptVersion: PROMPT_VERSION,
        onAttempt: (a) => t.callStarted('INDEPENDENT_ASSESSMENT', persona.key, a, idx, personas.length, 3),
      });

      if (result.ok && result.value) {
        independent.set(persona.key, {
          ...result.value,
          evidenceCited: result.value.evidenceCited ?? [],
          uncertainties: result.value.uncertainties ?? [],
        });
      }
      await t.callCompleted('INDEPENDENT_ASSESSMENT', persona.key, idx, personas.length, 3, result, {
        observation: `Assessed hypothesis ${hypothesis.label} against ${contexts.reduce((s, c) => s + c.fields.length, 0)} permitted evidence field(s)`,
        action: result.value
          ? `Stance: ${result.value.stance} (stated confidence ${result.value.confidence.toFixed(2)}); cited ${(result.value.evidenceCited ?? []).length} evidence item(s)`
          : 'No usable answer',
        stance: result.value?.stance,
        confidence: result.value?.confidence,
        evidenceCount: result.value ? (result.value.evidenceCited ?? []).length : undefined,
      });
    }

    if (independent.size === 0) {
      await step.finish(stepId, 'failed', undefined, 'No persona produced a usable answer.');
      throw new RunRefused([
        'No persona produced an answer that fitted the required shape, so there is nothing to ' +
          'synthesise.',
      ]);
    }
    if (independent.size < personas.length) {
      await warn(
        `${personas.length - independent.size} of ${personas.length} personas did not produce a ` +
          'usable answer in the independent round. The panel is smaller than it was configured to be.',
      );
    }
    await step.finish(stepId, 'completed', { answered: independent.size, of: personas.length });

    // ── 4. Consumer reaction ─────────────────────────────────────────────────
    stepId = await step.begin('CONSUMER_REACTION', stimulus ? independent.size : null);
    const reactions = new Map<string, ConsumerReaction>();

    if (!stimulus) {
      await step.finish(stepId, 'skipped', { reason: 'No stimulus was supplied.' });
    } else {
      let r = 0;
      for (const persona of personas) {
        if (!independent.has(persona.key)) continue;
        if (await cancelRequested(runId)) {
          await step.finish(stepId, 'skipped', undefined, 'Cancelled.');
          return await finishCancelled(runId, warnings, t);
        }
        r += 1;
        const idx = r;

        const result = await callModel({
          runId,
          stage: 'CONSUMER_REACTION',
          personaKey: persona.key,
          system: personaSystem(persona, evidenceText, brief),
          messages: [
            {
              role: 'user',
              content: [
                'React to the material below as the segment you represent.',
                '',
                wrapUntrusted(`${stimulus.label}: ${stimulus.name}`, stimulus.untrustedContent),
                '',
                'Respond with JSON: { "reaction": "positive" | "mixed" | "negative", "intensity":',
                '0..1, "verbatim": string, "drivers": string[], "barriers": string[] }',
              ].join('\n'),
            },
          ],
          schemaName: 'consumer_reaction',
          schema: ConsumerReaction,
          seed: deriveSeed(seed, 'reaction', persona.key),
          evidenceManifestHash: manifestHash,
          budgetCapUsd,
          promptTemplate: 'persona.reaction',
          promptVersion: PROMPT_VERSION,
          onAttempt: (a) => t.callStarted('CONSUMER_REACTION', persona.key, a, idx, independent.size, 4),
        });
        if (result.ok && result.value) {
          reactions.set(persona.key, {
            ...result.value,
            drivers: result.value.drivers ?? [],
            barriers: result.value.barriers ?? [],
          });
        }
        await t.callCompleted('CONSUMER_REACTION', persona.key, idx, independent.size, 4, result, {
          observation: `Reviewed stimulus "${stimulus.label}"`,
          action: result.value
            ? `Reaction: ${result.value.reaction} (intensity ${result.value.intensity.toFixed(2)}); ${(result.value.drivers ?? []).length} driver(s), ${(result.value.barriers ?? []).length} barrier(s)`
            : 'No usable answer',
          confidence: result.value?.intensity,
        });
      }
      await step.finish(stepId, 'completed', { reacted: reactions.size });
    }

    // ── 5. Cross-examination ─────────────────────────────────────────────────
    stepId = await step.begin('CROSS_EXAMINATION');

    const stances = [...independent.entries()];
    const majorityStance = majority(stances.map(([, a]) => a.stance));
    const challengers = stances.filter(([, a]) => a.stance === majorityStance);
    const needed = requiredChallengers(independent.size);

    // At least half the panel must argue against the prevailing view. A token objection produces a
    // dissent line without ever having tested the majority position.
    const toChallenge = (challengers.length >= needed ? challengers : stances).slice(0, Math.max(needed, 1));
    const challenges: { personaKey: string; value: CrossExamination }[] = [];
    await t.send({
      eventType: 'run.disagreement',
      stage: 'CROSS_EXAMINATION',
      status: 'active',
      message: `Prevailing independent view: ${majorityStance}. ${toChallenge.length} persona(s) will argue against it (${needed} required).`,
      progressCurrent: 0,
      progressTotal: toChallenge.length,
      safeMetadata: { majorityStance, challengers: toChallenge.length, required: needed },
    });
    let c = 0;

    for (const [personaKey] of toChallenge) {
      const persona = personas.find((p) => p.key === personaKey);
      if (!persona) continue;
      if (await cancelRequested(runId)) {
        await step.finish(stepId, 'skipped', undefined, 'Cancelled.');
        return await finishCancelled(runId, warnings, t);
      }
      c += 1;
      const idx = c;

      const others = stances
        .filter(([k]) => k !== personaKey)
        .map(([k, a]) => `- ${k}: ${a.stance} (confidence ${a.confidence.toFixed(2)}) — ${a.rationale}`)
        .join('\n');

      const result = await callModel({
        runId,
        stage: 'CROSS_EXAMINATION',
        personaKey,
        system: personaSystem(persona, evidenceText, brief),
        messages: [
          {
            role: 'user',
            content: [
              `The prevailing view on "${hypothesis.statement}" is: ${majorityStance}.`,
              '',
              'The other panellists said:',
              others,
              '',
              'Your task is to argue against the prevailing view — not to be contrary, but to find',
              'the strongest case that it is wrong. What would have to be true for it to be false?',
              'What else could produce the same pattern in the evidence?',
              hypothesis.alternativeExplanations.length > 0
                ? `\nAlternatives already identified: ${hypothesis.alternativeExplanations.join('; ')}`
                : '',
              '',
              'Respond with JSON: { "challenge": string, "targetsClaim": boolean,',
              '"alternativeExplanation": string, "severity": "minor" | "material" | "fundamental" }',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        schemaName: 'cross_examination',
        schema: CrossExamination,
        seed: deriveSeed(seed, 'challenge', personaKey),
        evidenceManifestHash: manifestHash,
        budgetCapUsd,
        promptTemplate: 'persona.challenge',
        promptVersion: PROMPT_VERSION,
        onAttempt: (a) => t.callStarted('CROSS_EXAMINATION', personaKey, a, idx, toChallenge.length, 5),
      });
      if (result.ok && result.value) challenges.push({ personaKey, value: result.value });
      await t.callCompleted('CROSS_EXAMINATION', personaKey, idx, toChallenge.length, 5, result, {
        observation: `Reviewed the prevailing view (${majorityStance}) and ${stances.length - 1} other position(s)`,
        action: result.value
          ? `Challenge raised (severity: ${result.value.severity}${result.value.targetsClaim ? ', targets the claim' : ''})`
          : 'No usable answer',
      });
    }

    if (challenges.length < needed) {
      await warn(
        `Only ${challenges.length} of the required ${needed} challenges were produced. The ` +
          'prevailing view was not put under the pressure this method requires, so any consensus ' +
          'below is weaker than it looks.',
      );
    }
    await step.finish(stepId, 'completed', { challenges: challenges.length, required: needed });

    // ── 6. Revision ──────────────────────────────────────────────────────────
    stepId = await step.begin('REVISION', independent.size);
    const revised = new Map<string, Revision>();
    const challengeText = challenges
      .map((c) => `- [${c.value.severity}] ${c.value.challenge}`)
      .join('\n');

    let v = 0;
    for (const persona of personas) {
      const own = independent.get(persona.key);
      if (!own) continue;
      if (await cancelRequested(runId)) {
        await step.finish(stepId, 'skipped', undefined, 'Cancelled.');
        return await finishCancelled(runId, warnings, t);
      }
      v += 1;
      const idx = v;

      const result = await callModel({
        runId,
        stage: 'REVISION',
        personaKey: persona.key,
        system: personaSystem(persona, evidenceText, brief),
        messages: [
          {
            role: 'user',
            content: [
              `You previously said: ${own.stance} (confidence ${own.confidence.toFixed(2)}).`,
              `Your reasoning was: ${own.rationale}`,
              '',
              'These challenges were raised:',
              challengeText || '- (none were produced)',
              '',
              'Reconsider. Changing your mind because an argument is good is the point of this',
              'round; changing it because others disagree is not, and is recorded as such.',
              'Holding your position is a perfectly good answer.',
              '',
              'Respond with JSON: { "changed": boolean, "stance": "confirm" | "dispute" |',
              '"abstain", "confidence": 0..1, "reason": string }',
            ].join('\n'),
          },
        ],
        schemaName: 'revision',
        schema: Revision,
        seed: deriveSeed(seed, 'revision', persona.key),
        evidenceManifestHash: manifestHash,
        budgetCapUsd,
        promptTemplate: 'persona.revision',
        promptVersion: PROMPT_VERSION,
        onAttempt: (a) => t.callStarted('REVISION', persona.key, a, idx, independent.size, 6),
      });
      if (result.ok && result.value) revised.set(persona.key, result.value);
      await t.callCompleted('REVISION', persona.key, idx, independent.size, 6, result, {
        observation: `Reviewed ${challenges.length} challenge(s) against its position (${own.stance})`,
        action: result.value
          ? result.value.changed
            ? `Changed position: ${own.stance} → ${result.value.stance} (stated confidence ${result.value.confidence.toFixed(2)})`
            : `Held position: ${result.value.stance} (stated confidence ${result.value.confidence.toFixed(2)})`
          : 'No usable answer',
        stance: result.value?.stance,
        confidence: result.value?.confidence,
      });
    }
    await step.finish(stepId, 'completed', { revised: revised.size });

    // ── 7. Synthesis ─────────────────────────────────────────────────────────
    stepId = await step.begin('SYNTHESIS');

    const keys = personas.map((p) => p.key).filter((k) => independent.has(k));
    const antiHerd = measureAntiHerd({
      independent: keys.map((k) => independent.get(k)!.stance),
      final: keys.map((k) => (revised.get(k)?.stance ?? independent.get(k)!.stance) as Stance),
    });

    if (antiHerd.herdingSuspected) {
      await warn(
        'Herding was detected: most personas changed position after seeing the others and then ' +
          'agreed almost entirely. The consensus below is one view held by many, not independent ' +
          'confirmation.',
      );
    }

    await t.send({
      eventType: 'run.antiherd',
      stage: 'SYNTHESIS',
      status: antiHerd.herdingSuspected ? 'warning' : 'active',
      severity: antiHerd.herdingSuspected ? 'warning' : 'info',
      message: `Flip rate ${antiHerd.flipRate.toFixed(2)}, capitulation ${antiHerd.capitulationRate.toFixed(2)}, entropy ${antiHerd.entropy.toFixed(2)}${antiHerd.herdingSuspected ? ' — herding suspected' : ''}.`,
      safeMetadata: {
        flipRate: antiHerd.flipRate,
        entropy: antiHerd.entropy,
        capitulationRate: antiHerd.capitulationRate,
        herdingSuspected: antiHerd.herdingSuspected,
      },
    });

    // Findings are written from the recorded positions, not asked of a model. The distribution of
    // stances is arithmetic, and a model asked to summarise arithmetic can get it wrong.
    const finalStances = keys.map(
      (k) => (revised.get(k)?.stance ?? independent.get(k)!.stance) as Stance,
    );
    const confirmCount = finalStances.filter((s) => s === 'confirm').length;
    const disputeCount = finalStances.filter((s) => s === 'dispute').length;
    const abstainCount = finalStances.filter((s) => s === 'abstain').length;
    const consensusRatio = finalStances.length === 0 ? 0 : confirmCount / finalStances.length;

    const classification = classify(consensusRatio, antiHerd);
    const isMock =
      (await prisma.modelCall.findFirst({ where: { runId }, select: { provider: true } }))
        ?.provider === 'mock';

    const finding = await prisma.finding.create({
      data: {
        runId,
        // A finding produced by a panel has no single author; the panel is named as the author so
        // that the field never implies one persona said it.
        authorPersonaKey: 'panel',
        title: `${confirmCount} of ${finalStances.length} personas support this claim`,
        claim: hypothesis.statement,
        // The ceiling that matters: a persona simulation is L3 and can never be graded higher,
        // however unanimous the panel. Only a measurement in the file is L1.
        evidenceGrade: 'L3_PERSONA_SIMULATION',
        confidence: antiHerd.herdingSuspected ? 'LOW' : consensusRatio >= 0.8 ? 'MEDIUM' : 'LOW',
        classification,
        consensusRatio: Math.round(consensusRatio * 1000) / 1000,
        segments: [...new Set(personas.map((p) => p.segment).filter((x): x is string => Boolean(x)))],
        baseSizes: Object.fromEntries(
          personas.filter((p) => p.baseSize !== null).map((p) => [p.key, p.baseSize]),
        ),
        limitations: [
          `${confirmCount} confirm, ${disputeCount} dispute, ${abstainCount} abstain.`,
          antiHerd.interpretation,
        ].join(' '),
        round: 2,
      },
    });

    // Both rounds are recorded per persona, because the independent position is the only one that
    // carries information and it must remain inspectable after the revision overwrote the view.
    for (const [key, assessment] of independent) {
      await prisma.personaVote.create({
        data: {
          findingId: finding.id,
          personaKey: key,
          vote: toVoteType(assessment.stance),
          round: 1,
          citedEvidence: assessment.evidenceCited.join('; ').slice(0, 2000) || null,
        },
      });
      const rev = revised.get(key);
      if (rev) {
        await prisma.personaVote.create({
          data: {
            findingId: finding.id,
            personaKey: key,
            vote: toVoteType(rev.stance),
            round: 2,
            challenge: rev.changed ? rev.reason.slice(0, 4000) : null,
          },
        });
      }
    }

    // Advisory: does each rationale argue the stance it states? Skipped for mock runs (the mock's
    // rationales are templates). A confident disagreement becomes a run warning; the stance is
    // recorded as stated and never rewritten.
    if (!isMock) {
      const items = [
        ...[...independent].map(([key, a]) => ({ key, stated: a.stance, rationale: a.rationale, round: 1 as const })),
        ...[...revised].map(([key, a]) => ({ key, stated: a.stance, rationale: a.reason, round: 2 as const })),
      ].filter((x) => x.rationale && x.rationale.trim().length > 0);
      const inconsistent = await checkStances(run.projectId, runId, hypothesis.statement, items);
      for (const j of inconsistent ?? []) {
        await warn(`${j.key}: stated "${j.stated}" but its rationale reads as "${j.judged}" (judge confidence ${j.confidence.toFixed(2)}). The stance is recorded as stated; read the rationale before relying on it.`);
      }
    }

    await prisma.antiHerdMetric.create({
      data: {
        runId,
        flipRate: antiHerd.flipRate,
        voteEntropy: antiHerd.entropy,
        // Two rounds of opinion in this protocol: independent, then revision.
        convergenceRounds: 2,
        // The share of personas that disputed independently and still disputed at the end. Dissent
        // that survives exposure is the only dissent worth reporting as such.
        dissentSurvival: dissentSurvival(keys, independent, revised),
        warningRaised: antiHerd.herdingSuspected,
      },
    });

    await step.finish(stepId, 'completed', { findingId: finding.id, ...antiHerd });

    // ── 8. Report ────────────────────────────────────────────────────────────
    stepId = await step.begin('REPORT');

    const limitations = [
      'Every result here is simulated. It is decision support. It is not evidence of what any real ' +
        'person thinks, believes or would do, and it does not replace research with real people.',
      antiHerd.interpretation,
      ...contexts.flatMap((c) => c.caveats),
      ...warnings,
    ];
    if (isMock) {
      limitations.unshift(
        'This run used the local mock provider. No AI model was consulted; these outputs exist to ' +
          'exercise the pipeline and mean nothing.',
      );
    }

    const synthesis = await prisma.synthesis.create({
      data: {
        runId,
        executiveSummary:
          `${confirmCount} of ${finalStances.length} simulated personas supported the claim ` +
          `"${hypothesis.statement}". ${antiHerd.interpretation}`,
        directAnswer: directAnswer(classification, consensusRatio, finalStances.length),
        qualifiedRecommendation:
          'Treat this as a hypothesis to test with real people, not as a result. The threshold set ' +
          'in the brief before this run is shown beside it in the report so you can judge for ' +
          'yourself whether it was met.',
        confidenceBasis:
          `Independent agreement before exposure was ${Math.round(antiHerd.independentAgreement * 100)}%; ` +
            `${Math.round(antiHerd.flipRate * 100)}% of personas changed position after seeing the ` +
          `challenges, and ${Math.round(antiHerd.capitulationRate * 100)}% of those who disagreed ` +
          `with the eventual majority abandoned that position; final stance entropy was ` +
          `${antiHerd.entropy.toFixed(2)}.`,
        groupthinkWarning: antiHerd.herdingSuspected,
        limitations: limitations.join('\n'),
      },
    });

    // Dissent is attached to the synthesis, so it cannot be dropped when the headline is read.
    const majorityFinal = majority(finalStances);
    for (const key of keys) {
      const finalStance = (revised.get(key)?.stance ?? independent.get(key)!.stance) as Stance;
      if (finalStance === majorityFinal) continue;
      await prisma.dissent.create({
        data: {
          synthesisId: synthesis.id,
          findingId: finding.id,
          personaKey: key,
          position: finalStance,
          evidenceNote: (revised.get(key)?.reason ?? independent.get(key)!.rationale).slice(0, 4000),
        },
      });
    }
    for (const c of challenges) {
      await prisma.dissent.create({
        data: {
          synthesisId: synthesis.id,
          findingId: finding.id,
          personaKey: c.personaKey,
          position: `challenge (${c.value.severity})`,
          evidenceNote: c.value.challenge.slice(0, 4000),
        },
      });
    }

    await step.finish(stepId, 'completed', { limitations: limitations.length });

    const spendUsd = await runSpendUsd(runId);
    const status = warnings.length > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED';

    await prisma.run.update({
      where: { id: runId },
      data: { status, completedAt: new Date(), isMock, isPartial: warnings.length > 0 },
    });

    await t.send({
      eventType: 'run.completed',
      stage: 'run',
      status: status === 'COMPLETED' ? 'completed' : 'warning',
      message:
        status === 'COMPLETED'
          ? 'Run completed. Final results are available.'
          : `Run completed with ${warnings.length} warning(s). Final results are available.`,
      safeMetadata: { classification, consensusRatio: Math.round(consensusRatio * 1000) / 1000 },
    });

    await recordAudit({
      action: 'run.completed',
      targetType: 'run',
      targetId: runId,
      projectId: run.projectId,
      afterValue: { status, spendUsd, warnings: warnings.length, isMock },
    });

    return { runId, status, isMock, spendUsd, findings: 1, warnings };
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      await prisma.run.update({
        where: { id: runId },
        data: { status: 'FAILED', completedAt: new Date(), failureReason: e.message },
      });
      await t.send({
        eventType: 'run.failed',
        stage: 'run',
        status: 'failed',
        severity: 'error',
        message: e.message,
      });
      await recordAudit({
        action: 'run.budget.exceeded',
        targetType: 'run',
        targetId: runId,
        projectId: run.projectId,
        reason: e.message,
      });
      throw e;
    }

    const reason =
      e instanceof RunRefused || e instanceof EvidenceRefused
        ? e.message
        : 'The run failed. The cause has been recorded in the server log.';

    await prisma.run.update({
      where: { id: runId },
      data: { status: 'FAILED', completedAt: new Date(), failureReason: reason.slice(0, 1000) },
    });
    await t.send({ eventType: 'run.failed', stage: 'run', status: 'failed', severity: 'error', message: reason.slice(0, 500) });
    await recordAudit({
      action: 'run.failed',
      targetType: 'run',
      targetId: runId,
      projectId: run.projectId,
      reason: reason.slice(0, 1000),
    });
    throw e;
  }
}

async function finishCancelled(runId: string, warnings: string[], t: Telemetry): Promise<RunOutcome> {
  await prisma.run.update({
    where: { id: runId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), isPartial: true },
  });
  await t.send({
    eventType: 'run.cancelled',
    stage: 'run',
    status: 'cancelled',
    message: 'Run cancelled on request. Partial results are not reported.',
  });
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, select: { projectId: true } });
  await recordAudit({
    action: 'run.cancelled',
    targetType: 'run',
    targetId: runId,
    projectId: run.projectId,
  });
  return {
    runId,
    status: 'CANCELLED',
    isMock: true,
    spendUsd: await runSpendUsd(runId),
    findings: 0,
    warnings: [...warnings, 'The run was cancelled before it finished. Partial results are not reported.'],
  };
}

function majority<T extends string>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] as T;
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

function toVoteType(stance: Stance): 'CONFIRM' | 'DISPUTE' | 'ABSTAIN' {
  return stance === 'confirm' ? 'CONFIRM' : stance === 'dispute' ? 'DISPUTE' : 'ABSTAIN';
}

/**
 * How a claim is classified after the panel has finished.
 *
 * Deliberately capped. `CONFIRMED` is never reachable from a persona simulation alone, however
 * unanimous — confirmation would require evidence of a kind this method cannot produce. Detected
 * herding pushes a claim to `CONTESTED` regardless of the tally, because a tally produced by
 * following is not a tally.
 */
export function classify(
  consensusRatio: number,
  antiHerd: { herdingSuspected: boolean; independentAgreement: number; panelSize: number },
): 'PROBABLE' | 'CONTESTED' | 'MINORITY_RETAINED' | 'DISCARDED' {
  if (antiHerd.panelSize < 3) return 'CONTESTED';
  if (antiHerd.herdingSuspected) return 'CONTESTED';
  if (consensusRatio >= 0.8 && antiHerd.independentAgreement >= 0.7) return 'PROBABLE';
  if (consensusRatio >= 0.5) return 'CONTESTED';
  if (consensusRatio > 0) return 'MINORITY_RETAINED';
  return 'DISCARDED';
}

function directAnswer(
  classification: string,
  consensusRatio: number,
  panelSize: number,
): string {
  const pct = Math.round(consensusRatio * 100);
  switch (classification) {
    case 'PROBABLE':
      return `Probably, on this evidence: ${pct}% of a ${panelSize}-persona simulated panel supported the claim, and most of them did so before seeing anyone else's view. This is a reason to test the claim with real people, not a reason to act on it.`;
    case 'MINORITY_RETAINED':
      return `Mostly not: only ${pct}% supported the claim, but the minority that did held its position and their reasoning is recorded below rather than averaged away.`;
    case 'DISCARDED':
      return `No. Not one persona in the panel supported the claim on this evidence.`;
    default:
      return `Unresolved. The panel did not settle: ${pct}% supported the claim and the disagreement is itself the finding. A single headline here would misrepresent what happened.`;
  }
}

/** The share of independent dissenters who were still dissenting at the end. */
function dissentSurvival(
  keys: string[],
  independent: Map<string, { stance: Stance }>,
  revised: Map<string, { stance: Stance }>,
): number {
  const dissenters = keys.filter((k) => independent.get(k)?.stance === 'dispute');
  if (dissenters.length === 0) return 0;
  const survived = dissenters.filter(
    (k) => (revised.get(k)?.stance ?? independent.get(k)!.stance) === 'dispute',
  ).length;
  return Math.round((survived / dissenters.length) * 1000) / 1000;
}
