/**
 * The persona agent-swarm debate.
 *
 * A crew of agents (see `crew.ts`) debates a motion under a hierarchical process: the moderator is
 * the manager, the persona agents are the workers, and an evidence analyst, a devil's advocate and
 * a synthesis judge are specialists. The phases are fixed:
 *
 *   1 FRAMING          moderator states the motion, sub-questions and decision criteria
 *   2 OPENING          every persona agent argues ALONE — nobody has seen another view
 *   3 EVIDENCE_REVIEW  the analyst checks the openings against the evidence items
 *   4 per round:
 *       MODERATION     the moderator hands the floor to named agents to answer named arguments
 *       REBUTTAL       those agents answer; conceding is allowed and recorded
 *       CHALLENGE      the devil's advocate argues against whatever the panel leans towards
 *   5 CLOSING          every persona agent states a final position and whether it moved, and why
 *   6 VERDICT          the judge writes the reference conclusion from the whole record
 *
 * Openings being isolated is what makes the movement metrics mean anything, exactly as in a run:
 * agreement measured after exposure tells you only that exposure happened. The segment comparison
 * the judge is shown is computed in code from the data, so the conclusion rests on something no
 * model wrote.
 */
import type { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { callModel, debateSpendUsd, modelProvider, BudgetExceeded } from '@/model/client';
import { deriveSeed } from '@/model/provider';
import { wrapUntrusted } from '@/model/context';
import { measureAntiHerd } from '@/run/antiHerd';
import type { Stance } from '@/run/schemas';
import { resolveHandoffs, specialistAgents, type DebateAgent, type DebatePhase } from './crew';
import {
  DebateClosing,
  DebateFraming,
  DebateOpening,
  DebateRebuttal,
  DebateVerdict,
  DevilChallenge,
  EvidenceReview,
  ModeratorHandoff,
  type DebateStance,
} from './schemas';
import { renderComparison, renderEvidenceItems } from './evidence';
import { DebateRefused, gatherDebateEvidence, isMissingFile, MISSING_FILES, simulationContext, type GatheredEvidence } from './sources';

export const DEBATE_PROMPT_VERSION = '1.0.0';
const MAX_SPEAKERS_PER_ROUND = 4;

export interface DebateOutcome {
  debateId: string;
  status: 'COMPLETED' | 'FAILED';
  turns: number;
  spendUsd: number;
  reason?: string;
}

interface Position {
  stance: DebateStance;
  confidence: number;
  argument: string;
  evidenceIds: string[];
}

const TO_STANCE: Record<DebateStance, Stance> = { support: 'confirm', oppose: 'dispute', undecided: 'abstain' };

// ── Prompts ───────────────────────────────────────────────────────────────────

function agentSystem(agent: DebateAgent, briefing: string): string {
  const persona =
    agent.kind === 'persona'
      ? [
          '',
          '## Who you represent',
          'You speak for a described SEGMENT of survey respondents, not for an individual and not as an assistant.',
          agent.backstory,
          agent.baseSize ? `The segment's base in the data is ${agent.baseSize}.` : '',
          '',
          'What is known about this segment. "observed" was measured, "derived" was computed from measurements,',
          '"inferred" and "simulated" measure nothing:',
          ...(agent.attributes ?? []).map((a) => `- [${a.origin.toLowerCase()}] ${a.label}: ${a.value}${a.baseSize ? ` (base ${a.baseSize})` : ''}`),
        ]
      : ['', `Backstory: ${agent.backstory}`];
  return [
    `You are "${agent.name}", an agent in a structured, moderated debate. The debate is a simulation used`,
    'for decision support; nothing said in it is evidence of what any real person thinks.',
    '',
    `Role: ${agent.role}`,
    `Goal: ${agent.goal}`,
    ...persona,
    '',
    briefing,
    '',
    '## Rules of the debate',
    '1. Ground every factual claim in the evidence items and cite them by id (e.g. "E4"). A figure that is not',
    '   in an item must not be stated. "The evidence does not show this" is a complete, correct answer.',
    '2. Watch the construct: a statement about AI in general, or about advertising in general, is not a',
    '   statement about AI advertising. Say when you are extrapolating.',
    '3. A small base means low confidence. A difference of a few points between segments may be noise; the',
    '   segment comparison computed in code says which differences are significant.',
    '4. Disagree when you have reason to, and concede when the evidence is against you. Changing your mind',
    '   because others agree is not a reason; changing it because of evidence is.',
    '5. Be constructive: answer the argument, not the agent.',
    '',
    'Reply with a single JSON object in the shape you are given. No prose outside it.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function briefingText(motion: string, hypothesis: string | null, evidence: GatheredEvidence, simulation: string | null): string {
  return [
    '## The motion',
    wrapUntrusted('debate motion', hypothesis ? `${motion}\n\nHypothesis under test: ${hypothesis}` : motion),
    '',
    '## Evidence items (latest wave per market, from data cleared for model processing)',
    renderEvidenceItems(evidence.selected.items),
    '',
    '## Segment comparison',
    renderComparison(evidence.selected.comparison),
    evidence.selected.notes.length ? `\nNotes on the evidence:\n${evidence.selected.notes.map((n) => `- ${n}`).join('\n')}` : '',
    simulation ? `\n## What this project's simulation concluded (simulated, not evidence)\n${simulation}` : '',
  ].join('\n');
}

function positionsText(agents: DebateAgent[], positions: Map<string, Position>, limit = 420): string {
  return agents
    .filter((a) => positions.has(a.key))
    .map((a) => {
      const p = positions.get(a.key)!;
      return `- ${a.key} (${a.name}${a.segment ? `, segment ${a.segment}` : ''}): ${p.stance.toUpperCase()} at ${p.confidence.toFixed(2)} — ${p.argument.slice(0, limit)}${p.evidenceIds.length ? ` [${p.evidenceIds.join(', ')}]` : ''}`;
    })
    .join('\n');
}

const SHAPE = {
  framing: '{ "motion": string, "subQuestions": string[], "decisionCriteria": string[], "groundRules": string[] }',
  opening: '{ "stance": "support" | "oppose" | "undecided", "confidence": 0..1, "argument": string, "keyPoints": string[], "evidenceIds": string[], "whatWouldChangeMyMind": string }',
  review: '{ "summary": string, "unsupportedClaims": [{ "agentKey": string, "claim": string, "reason": string }], "strongestEvidenceIds": string[], "evidenceGaps": string[] }',
  handoff: '{ "focus": string, "handoffs": [{ "agentKey": string, "respondTo": string, "prompt": string }] }',
  rebuttal: '{ "respondsTo": string, "rebuttal": string, "concedes": boolean, "stance": "support" | "oppose" | "undecided", "confidence": 0..1, "evidenceIds": string[] }',
  challenge: '{ "challenge": string, "alternativeExplanation": string, "evidenceIds": string[], "severity": "minor" | "material" | "fundamental" }',
  closing: '{ "stance": "support" | "oppose" | "undecided", "confidence": 0..1, "changed": boolean, "reason": string, "finalArgument": string, "evidenceIds": string[] }',
  verdict:
    '{ "answer": "supported" | "not_supported" | "mixed" | "insufficient_evidence", "conclusion": string, "confidence": "high" | "medium" | "low", ' +
    '"segmentFindings": [{ "segment": string, "assessment": string, "evidenceIds": string[] }], "argumentsFor": string[], "argumentsAgainst": string[], ' +
    '"consensus": string[], "dissent": string[], "evidenceGaps": string[], "recommendations": string[] }',
};

// ── Execution ─────────────────────────────────────────────────────────────────

export async function executeDebate(debateId: string): Promise<DebateOutcome> {
  const debate = await prisma.debate.findUnique({
    where: { id: debateId },
    include: {
      cohort: {
        include: {
          personas: {
            include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, include: { attributes: true } } },
          },
        },
      },
    },
  });
  if (!debate) throw new Error(`Debate ${debateId} does not exist.`);
  if (debate.status === 'COMPLETED') return { debateId, status: 'COMPLETED', turns: 0, spendUsd: debate.spendUsd };

  const isMock = modelProvider().name === 'mock';
  await prisma.debate.update({ where: { id: debateId }, data: { status: 'RUNNING', startedAt: new Date(), isMock, failureReason: null } });
  // A retried job starts the transcript again rather than appending to a half-finished one.
  await prisma.debateTurn.deleteMany({ where: { debateId } });

  let seq = 0;
  const addTurn = async (t: {
    phase: DebatePhase;
    round?: number;
    agent: DebateAgent;
    stance?: DebateStance | null;
    confidence?: number | null;
    addressedTo?: string[];
    content: unknown;
    ok?: boolean;
  }) => {
    seq += 1;
    await prisma.debateTurn.create({
      data: {
        debateId,
        seq,
        round: t.round ?? 0,
        phase: t.phase,
        agentKey: t.agent.key,
        agentName: t.agent.name,
        agentRole: t.agent.role,
        stance: t.stance ?? null,
        confidence: t.confidence ?? null,
        addressedTo: t.addressedTo ?? [],
        content: t.content as object,
        ok: t.ok ?? true,
      },
    });
  };
  const setPhase = (phase: DebatePhase, round = 0) =>
    prisma.debate.update({ where: { id: debateId }, data: { phase: round ? `${phase}:${round}` : phase } });

  try {
    // ── Evidence and agents ───────────────────────────────────────────────────
    const motionText = [debate.topic, debate.hypothesis ?? ''].join(' ');
    const evidence = await gatherDebateEvidence(debate.projectId, motionText, debate.focusSegments);
    const simulation = await simulationContext(debate.projectId, debate.contextRunId);
    const validIds = new Set(evidence.selected.items.map((e) => e.id));
    let citations = 0;
    let invalidCitations = 0;
    const cite = (ids: string[]): string[] => {
      citations += ids.length;
      const ok = [...new Set(ids.map((i) => i.trim().toUpperCase()))].filter((i) => validIds.has(i));
      invalidCitations += ids.length - ok.length;
      return ok;
    };

    const personas = pickPersonas(debate.cohort.personas, evidence.focusMatched);
    if (personas.length < 2) {
      return await fail(debateId, 'The debate needs at least two approved personas in the cohort.', debate.createdById, debate.projectId);
    }
    const specialists = specialistAgents();
    const [moderator, analyst, advocate, judge] = specialists as [DebateAgent, DebateAgent, DebateAgent, DebateAgent];
    const agents = [...specialists, ...personas];
    await prisma.debate.update({
      where: { id: debateId },
      data: {
        agents: agents.map(({ attributes: _a, ...a }) => a) as unknown as object,
        evidence: {
          sources: evidence.sources,
          manifestHashes: evidence.manifestHashes,
          items: evidence.selected.items,
          statements: evidence.selected.statementsSelected,
          statementsConsidered: evidence.selected.statementsConsidered,
          focus: evidence.selected.focus,
          comparison: evidence.selected.comparison,
          notes: evidence.selected.notes,
          simulation,
        } as unknown as object,
      },
    });

    const briefing = briefingText(debate.topic, debate.hypothesis, evidence, simulation);
    const cap = env().AI_RUN_BUDGET_USD;
    const call = <T,>(o: {
      agent: DebateAgent;
      phase: DebatePhase;
      round?: number;
      content: string;
      schemaName: string;
      schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    }) =>
      callModel<T>({
        debateId,
        stage: `DEBATE_${o.phase}`,
        personaKey: o.agent.key,
        system: agentSystem(o.agent, briefing),
        messages: [{ role: 'user', content: o.content }],
        schemaName: o.schemaName,
        schema: o.schema,
        seed: deriveSeed(debate.seed, o.phase, String(o.round ?? 0), o.agent.key),
        evidenceManifestHash: evidence.manifestHashes[0],
        budgetCapUsd: cap,
        promptTemplate: `debate.${o.phase.toLowerCase()}`,
        promptVersion: DEBATE_PROMPT_VERSION,
      });

    const roster = personas.map((p) => `- ${p.key}: ${p.name}${p.segment ? ` (segment ${p.segment})` : ''}`).join('\n');

    // ── 1 Framing ─────────────────────────────────────────────────────────────
    await setPhase('FRAMING');
    const framing = await call<DebateFraming>({
      agent: moderator,
      phase: 'FRAMING',
      content: [
        'Frame the debate before anyone speaks. Restate the motion precisely, break it into the sub-questions that',
        'decide it, and state the criteria the verdict should use. The panel:',
        roster,
        '',
        `Respond with JSON: ${SHAPE.framing}`,
      ].join('\n'),
      schemaName: 'debate_framing',
      schema: DebateFraming,
    });
    await addTurn({ phase: 'FRAMING', agent: moderator, content: framing.value ?? { error: framing.outcome }, ok: framing.ok });
    const framingText = framing.value
      ? `Motion as framed: ${framing.value.motion}\nSub-questions:\n${framing.value.subQuestions.map((q) => `- ${q}`).join('\n')}\nDecision criteria:\n${framing.value.decisionCriteria.map((c) => `- ${c}`).join('\n')}`
      : `Motion: ${debate.topic}`;

    // ── 2 Openings, in isolation ──────────────────────────────────────────────
    await setPhase('OPENING');
    const opening = new Map<string, Position>();
    for (const p of personas) {
      const r = await call<DebateOpening>({
        agent: p,
        phase: 'OPENING',
        content: [
          framingText,
          '',
          'Give your opening position. You are answering ALONE: you have not seen any other agent\'s view and should',
          'not guess at one. Argue from how your segment relates to the motion, citing evidence items by id.',
          '',
          `Respond with JSON: ${SHAPE.opening}`,
        ].join('\n'),
        schemaName: 'debate_opening',
        schema: DebateOpening,
      });
      if (r.ok && r.value) {
        const ids = cite(r.value.evidenceIds);
        opening.set(p.key, { stance: r.value.stance, confidence: r.value.confidence, argument: r.value.argument, evidenceIds: ids });
        await addTurn({ phase: 'OPENING', agent: p, stance: r.value.stance, confidence: r.value.confidence, content: { ...r.value, evidenceIds: ids } });
      } else {
        await addTurn({ phase: 'OPENING', agent: p, content: { error: r.outcome }, ok: false });
      }
    }
    if (opening.size < 2) {
      return await fail(debateId, 'Fewer than two persona agents produced a valid opening, so there was nothing to debate.', debate.createdById, debate.projectId);
    }
    const current = new Map(opening);
    const speakers = personas.filter((p) => opening.has(p.key));

    // ── 3 Evidence review ─────────────────────────────────────────────────────
    await setPhase('EVIDENCE_REVIEW');
    const review = await call<EvidenceReview>({
      agent: analyst,
      phase: 'EVIDENCE_REVIEW',
      content: [
        framingText,
        '',
        'The opening statements:',
        positionsText(speakers, opening, 900),
        '',
        'Check each against the evidence items. Name every claim the evidence does not support (with the agent key),',
        'the strongest evidence ids either way, and what the evidence cannot answer.',
        '',
        `Respond with JSON: ${SHAPE.review}`,
      ].join('\n'),
      schemaName: 'debate_evidence_review',
      schema: EvidenceReview,
    });
    const reviewValue = review.value ? { ...review.value, strongestEvidenceIds: cite(review.value.strongestEvidenceIds) } : null;
    await addTurn({ phase: 'EVIDENCE_REVIEW', agent: analyst, content: reviewValue ?? { error: review.outcome }, ok: review.ok });
    const reviewText = reviewValue
      ? `Evidence analyst: ${reviewValue.summary}${reviewValue.unsupportedClaims.length ? `\nUnsupported claims:\n${reviewValue.unsupportedClaims.map((u) => `- ${u.agentKey}: "${u.claim}" — ${u.reason}`).join('\n')}` : ''}`
      : '';

    // ── 4 Rounds ──────────────────────────────────────────────────────────────
    let concessions = 0;
    let replacedHandoffs = 0;
    const roundLog: string[] = [];
    for (let round = 1; round <= debate.rounds; round += 1) {
      await setPhase('MODERATION', round);
      const mod = await call<ModeratorHandoff>({
        agent: moderator,
        phase: 'MODERATION',
        round,
        content: [
          framingText,
          '',
          'Current positions:',
          positionsText(speakers, current),
          reviewText ? `\n${reviewText}` : '',
          roundLog.length ? `\nSo far:\n${roundLog.join('\n')}` : '',
          '',
          `Round ${round} of ${debate.rounds}. Choose the focus for this round and hand the floor to up to ${MAX_SPEAKERS_PER_ROUND}`,
          'persona agents (by key), each answering a named agent whose argument most needs answering. Give the',
          'minority a hearing; do not let the majority simply repeat itself.',
          '',
          `Respond with JSON: ${SHAPE.handoff}`,
        ].join('\n'),
        schemaName: 'debate_handoff',
        schema: ModeratorHandoff,
      });
      const focus = mod.value?.focus ?? `The strongest disagreement on: ${debate.topic}`;
      const resolved = resolveHandoffs({
        proposed: mod.value?.handoffs ?? [],
        personas: speakers.map((p) => ({ key: p.key, stance: current.get(p.key)!.stance, confidence: current.get(p.key)!.confidence })),
        maxSpeakers: MAX_SPEAKERS_PER_ROUND,
        round,
        focus,
      });
      if (resolved.replaced) replacedHandoffs += 1;
      await addTurn({
        phase: 'MODERATION',
        round,
        agent: moderator,
        addressedTo: resolved.handoffs.map((h) => h.agentKey),
        content: { focus, handoffs: resolved.handoffs, replaced: resolved.replaced, reason: resolved.reason },
        ok: mod.ok,
      });

      await setPhase('REBUTTAL', round);
      for (const h of resolved.handoffs) {
        const agent = speakers.find((p) => p.key === h.agentKey)!;
        const target = agents.find((a) => a.key === h.respondTo);
        const targetPos = current.get(h.respondTo);
        const r = await call<DebateRebuttal>({
          agent,
          phase: 'REBUTTAL',
          round,
          content: [
            framingText,
            '',
            `Round ${round}. The moderator's focus: ${focus}`,
            `The moderator hands you the floor: ${h.prompt}`,
            '',
            `You are answering ${h.respondTo} (${target?.name ?? h.respondTo}), who argued:`,
            targetPos ? `${targetPos.stance.toUpperCase()} — ${targetPos.argument}` : (roundLog.filter((l) => l.startsWith(`- ${h.respondTo}`)).pop() ?? '(see the record)'),
            '',
            'Your position so far:',
            `${current.get(agent.key)!.stance.toUpperCase()} at ${current.get(agent.key)!.confidence.toFixed(2)} — ${current.get(agent.key)!.argument.slice(0, 600)}`,
            '',
            'All current positions:',
            positionsText(speakers, current, 240),
            '',
            'Answer the argument. Concede the points the evidence gives the other side; hold the ones it gives you.',
            '',
            `Respond with JSON: ${SHAPE.rebuttal}`,
          ].join('\n'),
          schemaName: 'debate_rebuttal',
          schema: DebateRebuttal,
        });
        if (r.ok && r.value) {
          const ids = cite(r.value.evidenceIds);
          if (r.value.concedes) concessions += 1;
          current.set(agent.key, { stance: r.value.stance, confidence: r.value.confidence, argument: r.value.rebuttal, evidenceIds: ids });
          roundLog.push(`- ${agent.key} → ${h.respondTo} (round ${round}): ${r.value.concedes ? 'concedes; ' : ''}${r.value.stance.toUpperCase()} — ${r.value.rebuttal.slice(0, 300)}`);
          await addTurn({ phase: 'REBUTTAL', round, agent, stance: r.value.stance, confidence: r.value.confidence, addressedTo: [h.respondTo], content: { ...r.value, respondsTo: h.respondTo, evidenceIds: ids } });
        } else {
          await addTurn({ phase: 'REBUTTAL', round, agent, addressedTo: [h.respondTo], content: { error: r.outcome }, ok: false });
        }
      }

      await setPhase('CHALLENGE', round);
      const lean = leaning(current);
      const ch = await call<DevilChallenge>({
        agent: advocate,
        phase: 'CHALLENGE',
        round,
        content: [
          framingText,
          '',
          'Current positions:',
          positionsText(speakers, current),
          '',
          lean
            ? `The panel currently leans ${lean.toUpperCase()}. Make the strongest evidence-based case against that lean, including`
            : 'The panel is split evenly. Make the strongest evidence-based case against the more confident side, including',
          'any alternative explanation the panel has not ruled out.',
          '',
          `Respond with JSON: ${SHAPE.challenge}`,
        ].join('\n'),
        schemaName: 'debate_challenge',
        schema: DevilChallenge,
      });
      const chValue = ch.value ? { ...ch.value, evidenceIds: cite(ch.value.evidenceIds), against: lean } : null;
      if (chValue) roundLog.push(`- advocate (round ${round}, against ${lean ?? 'the more confident side'}): ${chValue.challenge.slice(0, 300)}`);
      await addTurn({ phase: 'CHALLENGE', round, agent: advocate, addressedTo: speakers.filter((p) => current.get(p.key)!.stance === lean).map((p) => p.key), content: chValue ?? { error: ch.outcome }, ok: ch.ok });
    }

    // ── 5 Closings ────────────────────────────────────────────────────────────
    await setPhase('CLOSING');
    const closing = new Map<string, Position & { changed: boolean; reason: string }>();
    for (const p of speakers) {
      const open = opening.get(p.key)!;
      const r = await call<DebateClosing>({
        agent: p,
        phase: 'CLOSING',
        content: [
          framingText,
          '',
          `Your opening position: ${open.stance.toUpperCase()} at ${open.confidence.toFixed(2)} — ${open.argument.slice(0, 600)}`,
          '',
          'What was said in the debate:',
          roundLog.join('\n') || '(no rebuttals were recorded)',
          reviewText ? `\n${reviewText}` : '',
          '',
          'State your final position. Say whether it changed from your opening, and why — "others agreed" is not a reason.',
          '',
          `Respond with JSON: ${SHAPE.closing}`,
        ].join('\n'),
        schemaName: 'debate_closing',
        schema: DebateClosing,
      });
      if (r.ok && r.value) {
        const ids = cite(r.value.evidenceIds);
        // "Changed" is decided by comparing stances, not by what the agent says about itself.
        const changed = r.value.stance !== open.stance;
        closing.set(p.key, { stance: r.value.stance, confidence: r.value.confidence, argument: r.value.finalArgument, evidenceIds: ids, changed, reason: r.value.reason });
        await addTurn({ phase: 'CLOSING', agent: p, stance: r.value.stance, confidence: r.value.confidence, content: { ...r.value, changed, evidenceIds: ids } });
      } else {
        await addTurn({ phase: 'CLOSING', agent: p, content: { error: r.outcome }, ok: false });
      }
    }

    // ── Metrics, computed in code ─────────────────────────────────────────────
    const finalOf = (k: string) => closing.get(k) ?? current.get(k)!;
    const herd = measureAntiHerd({
      independent: speakers.map((p) => TO_STANCE[opening.get(p.key)!.stance]),
      final: speakers.map((p) => TO_STANCE[finalOf(p.key).stance]),
    });
    const tally = (m: (k: string) => { stance: DebateStance }) =>
      Object.fromEntries((['support', 'oppose', 'undecided'] as const).map((s) => [s, speakers.filter((p) => m(p.key).stance === s).length]));
    const metrics = {
      panelSize: speakers.length,
      openingStances: tally((k) => opening.get(k)!),
      closingStances: tally(finalOf),
      movedAgents: speakers.filter((p) => opening.get(p.key)!.stance !== finalOf(p.key).stance).map((p) => p.key),
      concessions,
      replacedHandoffs,
      citations,
      invalidCitations,
      citationValidity: citations === 0 ? null : Math.round(((citations - invalidCitations) / citations) * 100) / 100,
      entropy: herd.entropy,
      capitulationRate: herd.capitulationRate,
      independentAgreement: herd.independentAgreement,
      finalAgreement: herd.finalAgreement,
      herdingSuspected: herd.herdingSuspected,
      herdingInterpretation: herd.interpretation,
      bySegment: speakers.map((p) => ({ key: p.key, name: p.name, segment: p.segment ?? null, opening: opening.get(p.key)!.stance, closing: finalOf(p.key).stance, confidence: finalOf(p.key).confidence })),
    };

    // ── 6 Verdict ─────────────────────────────────────────────────────────────
    await setPhase('VERDICT');
    const verdict = await call<DebateVerdict>({
      agent: judge,
      phase: 'VERDICT',
      content: [
        framingText,
        '',
        'Opening positions (given in isolation):',
        positionsText(speakers, opening, 500),
        '',
        'Closing positions:',
        speakers.map((p) => {
          const c = closing.get(p.key);
          return c ? `- ${p.key} (${p.name}): ${c.stance.toUpperCase()} at ${c.confidence.toFixed(2)}${c.changed ? ' (moved)' : ''} — ${c.argument.slice(0, 400)} Reason: ${c.reason.slice(0, 200)}` : `- ${p.key}: no valid closing`;
        }).join('\n'),
        '',
        'What was said in the debate:',
        roundLog.join('\n') || '(no rebuttals were recorded)',
        reviewText ? `\n${reviewText}` : '',
        '',
        `Movement, computed in code: ${herd.interpretation}`,
        '',
        'Write the reference conclusion. Weigh arguments by the evidence behind them, not by how many agents made',
        'them; a simulated consensus is not a finding. Where the segment comparison computed in code speaks to the',
        'motion, your conclusion must agree with it or say why it does not apply. If the evidence does not address',
        'the motion, the answer is "insufficient_evidence".',
        '',
        `Respond with JSON: ${SHAPE.verdict}`,
      ].join('\n'),
      schemaName: 'debate_verdict',
      schema: DebateVerdict,
    });
    const verdictValue = verdict.value
      ? { ...verdict.value, segmentFindings: verdict.value.segmentFindings.map((s) => ({ ...s, evidenceIds: cite(s.evidenceIds) })) }
      : null;
    await addTurn({ phase: 'VERDICT', agent: judge, content: verdictValue ?? { error: verdict.outcome }, ok: verdict.ok });

    const caveats = [
      isMock ? 'Produced by the local mock provider: no AI model was consulted, and the arguments and verdict are placeholders that exercise the debate. Only the evidence items and the segment comparison are real.' : null,
      'Every agent is a simulation of a published segment. Their agreement is not independent confirmation — they share one model and one prompt.',
      herd.herdingSuspected ? `Herding suspected: ${herd.interpretation}` : null,
      evidence.selected.items.length === 0 ? 'No statement in the cleared data addressed the motion, so no argument could be grounded in evidence.' : null,
      invalidCitations > 0 ? `${invalidCitations} citation(s) named evidence that does not exist and were removed.` : null,
      ...evidence.selected.notes,
    ].filter((c): c is string => Boolean(c));

    const spendUsd = await debateSpendUsd(debateId);
    await prisma.debate.update({
      where: { id: debateId },
      data: {
        status: 'COMPLETED',
        phase: null,
        completedAt: new Date(),
        spendUsd,
        metrics: metrics as unknown as object,
        conclusion: {
          verdict: verdictValue,
          framing: framing.value ?? null,
          comparison: evidence.selected.comparison,
          caveats,
        } as unknown as object,
      },
    });
    await recordAudit({
      action: 'debate.completed',
      targetType: 'debate',
      targetId: debateId,
      projectId: debate.projectId,
      actorUserId: debate.createdById,
      reason: `Swarm debate completed: ${speakers.length} persona agents, ${debate.rounds} round(s), ${seq} turns${isMock ? ' (mock provider)' : ''}`,
    });
    return { debateId, status: 'COMPLETED', turns: seq, spendUsd };
  } catch (e) {
    if (e instanceof BudgetExceeded) return fail(debateId, e.message, debate.createdById, debate.projectId);
    if (e instanceof DebateRefused) return fail(debateId, e.reasons.join(' '), debate.createdById, debate.projectId);
    console.error('[debate] unexpected failure', e);
    return fail(debateId, describeFailure(e), debate.createdById, debate.projectId);
  }
}

/**
 * A failure reason a person can act on. Only the error's class and code are used — never its
 * message, which can quote data values or file paths.
 */
export function describeFailure(e: unknown): string {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  if (isMissingFile(e)) return `A stored data file could not be found. ${MISSING_FILES}`;
  if (typeof code === 'string' && /^P\d{4}$/.test(code)) {
    return `The debate stopped on a database error (${code}). Check the database is running and migrated (npm run db:deploy); details are in the worker window.`;
  }
  const kind = e instanceof Error ? e.name : 'Error';
  return `The debate stopped with an internal error (${kind}${typeof code === 'string' ? ` ${code}` : ''}). Details are in the worker window.`;
}

async function fail(debateId: string, reason: string, actor: string, projectId: string): Promise<DebateOutcome> {
  const spendUsd = await debateSpendUsd(debateId);
  await prisma.debate.update({ where: { id: debateId }, data: { status: 'FAILED', phase: null, failureReason: reason.slice(0, 1000), completedAt: new Date(), spendUsd } });
  await recordAudit({ action: 'debate.failed', targetType: 'debate', targetId: debateId, projectId, actorUserId: actor, reason: reason.slice(0, 300) });
  const turns = await prisma.debateTurn.count({ where: { debateId } });
  return { debateId, status: 'FAILED', turns, spendUsd, reason };
}

/** The stance most agents hold, or null on a tie. */
export function leaning(positions: Map<string, { stance: DebateStance }>): DebateStance | null {
  const counts = new Map<DebateStance, number>();
  for (const p of positions.values()) counts.set(p.stance, (counts.get(p.stance) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0 || (sorted.length > 1 && sorted[0]![1] === sorted[1]![1])) return null;
  return sorted[0]![0];
}

type CohortPersona = {
  id: string;
  name: string;
  versions: {
    approval: string;
    summary: string | null;
    segment: string | null;
    weight: number;
    baseSize: number | null;
    coverageNote: string | null;
    enabled: boolean;
    attributes: { label: string; value: string; origin: string; baseSize: number | null }[];
  }[];
};

const MAX_PERSONA_AGENTS = 8;

/**
 * Persona agents for the crew: approved and enabled personas only, those matching a focus segment
 * first (so the segments the motion is about are always at the table), then by weight.
 */
export function pickPersonas(personas: CohortPersona[], focus: string[]): DebateAgent[] {
  const approved = personas.filter((p) => p.versions[0]?.approval === 'APPROVED' && p.versions[0]?.enabled !== false);
  const f = focus.map((s) => s.toLowerCase());
  const matchesFocus = (p: CohortPersona) => {
    const text = `${p.name} ${p.versions[0]?.segment ?? ''}`.toLowerCase();
    return f.some((s) => text.includes(s));
  };
  const ordered = [...approved].sort(
    (a, b) => Number(matchesFocus(b)) - Number(matchesFocus(a)) || (b.versions[0]!.weight - a.versions[0]!.weight) || a.name.localeCompare(b.name),
  );
  return ordered.slice(0, MAX_PERSONA_AGENTS).map((p, i) => {
    const v = p.versions[0]!;
    const attrs = [...v.attributes].sort((a, b) => ORIGIN_RANK[a.origin]! - ORIGIN_RANK[b.origin]!).slice(0, 14);
    return {
      key: `P${i + 1}`,
      name: p.name,
      kind: 'persona' as const,
      personaId: p.id,
      segment: v.segment,
      baseSize: v.baseSize,
      role: `Consumer segment persona${v.segment ? `: ${v.segment}` : ''}`,
      goal: 'Represent how this segment would reason about the motion, grounded in what the evidence shows about this segment — and say where it does not.',
      backstory: [v.summary ?? `A persona summarising the "${p.name}" segment.`, v.coverageNote ? `Coverage: ${v.coverageNote}` : ''].filter(Boolean).join(' '),
      attributes: attrs,
    };
  });
}

const ORIGIN_RANK: Record<string, number> = { OBSERVED: 0, DERIVED: 1, USER_ENTERED: 2, INFERRED: 3, SIMULATED: 4 };

