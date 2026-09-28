/**
 * The agent-swarm vocabulary, after CrewAI and OpenAI's Swarm, adapted to this platform.
 *
 * From CrewAI: an **agent** is a role, a goal and a backstory; a **task** has a description, an
 * expected output, an assigned agent and the earlier tasks whose output it may read (its context);
 * a **crew** runs its tasks under a **process** — here the hierarchical one, where a manager agent
 * (the moderator) decides who works next. From Swarm: control passes between agents by explicit
 * **handoffs**, and the manager's handoff is the only way an agent gets the floor.
 *
 * What is deliberately *not* borrowed is the open loop. Neither framework is used as a runtime:
 * the phases, the number of rounds and the order of work are fixed in code, the manager can only
 * choose among agents that exist, and every handoff it makes is validated — an invalid or lopsided
 * one is replaced by a deterministic choice that gives the minority the floor. A debate has to be
 * reproducible and auditable like a run, so the shape of the conversation is never left to a model.
 */

export type AgentKind = 'persona' | 'moderator' | 'analyst' | 'advocate' | 'judge';

export interface DebateAgent {
  key: string;
  name: string;
  kind: AgentKind;
  /** CrewAI's three defining fields. */
  role: string;
  goal: string;
  backstory: string;
  /** Persona agents only. */
  personaId?: string;
  segment?: string | null;
  baseSize?: number | null;
  attributes?: { label: string; value: string; origin: string; baseSize: number | null }[];
}

export interface DebateTask {
  key: string;
  phase: DebatePhase;
  description: string;
  expectedOutput: string;
  agentKey: string;
  /** Keys of earlier tasks whose output this task may read. Empty means isolation. */
  context: string[];
}

export const DEBATE_PHASES = [
  'FRAMING',
  'OPENING',
  'EVIDENCE_REVIEW',
  'MODERATION',
  'REBUTTAL',
  'CHALLENGE',
  'CLOSING',
  'VERDICT',
] as const;
export type DebatePhase = (typeof DEBATE_PHASES)[number];

export const PHASE_LABEL: Record<DebatePhase, string> = {
  FRAMING: 'Framing',
  OPENING: 'Opening statements',
  EVIDENCE_REVIEW: 'Evidence review',
  MODERATION: 'Moderator handoff',
  REBUTTAL: 'Rebuttal',
  CHALLENGE: "Devil's advocate",
  CLOSING: 'Closing statements',
  VERDICT: 'Verdict',
};

/** The four specialist agents every crew has, alongside one agent per persona. */
export function specialistAgents(): DebateAgent[] {
  return [
    {
      key: 'moderator',
      name: 'Moderator',
      kind: 'moderator',
      role: 'Debate moderator (manager agent)',
      goal:
        'Run a fair, evidence-led debate on the motion: frame it precisely, hand the floor to the agents whose ' +
        'disagreement is most informative, make sure minority positions are answered rather than out-voted, and stop repetition.',
      backstory:
        'An impartial research chair who has run hundreds of consumer panels. Cares about whether an argument is ' +
        'grounded in the evidence, not about how many agents repeat it.',
    },
    {
      key: 'analyst',
      name: 'Evidence analyst',
      kind: 'analyst',
      role: 'Evidence analyst',
      goal:
        'Check every claim in the opening statements against the evidence items; name each claim the evidence does ' +
        'not support, each figure that is misread, and what the evidence cannot answer.',
      backstory:
        'A survey methodologist. Knows that a share is only as good as its base, that a statement about AI in general ' +
        'is not a statement about AI advertising, and that a difference of a few points between small segments is noise.',
    },
    {
      key: 'advocate',
      name: "Devil's advocate",
      kind: 'advocate',
      role: "Devil's advocate (red team)",
      goal:
        'Argue the strongest evidence-based case against whatever the panel currently leans towards, including ' +
        'alternative explanations the majority has not ruled out.',
      backstory:
        'Assigned to disagree on purpose, because a panel of simulated personas shares one model and agrees too easily. ' +
        'Only uses the evidence provided; never invents a figure to win a point.',
    },
    {
      key: 'judge',
      name: 'Synthesis judge',
      kind: 'judge',
      role: 'Synthesis judge',
      goal:
        'Weigh the debate by the evidence behind each argument, not by how many agents made it, and write a reference ' +
        'conclusion that states what the data supports, what it does not, and where the panel still disagrees.',
      backstory:
        'A senior insight director who signs off conclusions for clients. Would rather say "the evidence does not show ' +
        'this" than overstate a simulated consensus.',
    },
  ];
}

/**
 * Validate the manager's handoffs, and replace them when they are unusable.
 *
 * A handoff must name a persona agent and point it at another agent. At most `maxSpeakers` are
 * kept, each agent speaks once per round, and at least one speaker must hold a minority stance when
 * one exists — otherwise the "debate" is the majority agreeing with itself. If the manager's choice
 * fails any of that, the round falls back to a deterministic choice: minority holders first, each
 * answering the most confident agent of the opposing view.
 */
export function resolveHandoffs(input: {
  proposed: { agentKey: string; respondTo: string; prompt: string }[];
  personas: { key: string; stance: string; confidence: number }[];
  maxSpeakers: number;
  round: number;
  focus: string;
}): { handoffs: { agentKey: string; respondTo: string; prompt: string }[]; replaced: boolean; reason: string | null } {
  const keys = new Set(input.personas.map((p) => p.key));
  const allKeys = new Set([...keys, 'advocate', 'analyst']);
  const seen = new Set<string>();
  const valid = input.proposed.filter((h) => {
    if (!keys.has(h.agentKey) || !allKeys.has(h.respondTo) || h.agentKey === h.respondTo || seen.has(h.agentKey)) return false;
    seen.add(h.agentKey);
    return true;
  }).slice(0, input.maxSpeakers);

  const counts = new Map<string, number>();
  for (const p of input.personas) counts.set(p.stance, (counts.get(p.stance) ?? 0) + 1);
  const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const minority = input.personas.filter((p) => p.stance !== majority);
  const hearsMinority = minority.length === 0 || valid.some((h) => minority.some((m) => m.key === h.agentKey));

  if (valid.length > 0 && hearsMinority) return { handoffs: valid, replaced: false, reason: null };

  // Deterministic fallback. Rotate by round so the same agents do not always speak.
  const byConfidence = [...input.personas].sort((a, b) => b.confidence - a.confidence || a.key.localeCompare(b.key));
  const rotate = <T,>(xs: T[]) => (xs.length ? [...xs.slice(input.round % xs.length), ...xs.slice(0, input.round % xs.length)] : xs);
  const order = [...rotate(minority), ...rotate(byConfidence.filter((p) => p.stance === majority))];
  const handoffs = order.slice(0, input.maxSpeakers).map((p) => {
    const opponent = byConfidence.find((o) => o.stance !== p.stance && o.key !== p.key);
    return {
      agentKey: p.key,
      respondTo: opponent?.key ?? 'advocate',
      prompt: `Answer the strongest argument against your position on: ${input.focus}`,
    };
  });
  return {
    handoffs,
    replaced: true,
    reason:
      input.proposed.length === 0
        ? 'The moderator named no valid speakers; the floor went to minority positions first.'
        : !hearsMinority
          ? 'The moderator handed the floor only to the majority; replaced so a minority position is heard.'
          : 'The moderator named agents that do not exist; replaced with a deterministic choice.',
  };
}
