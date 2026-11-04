import type { getDebate } from '@/debate/service';
import type { DebateView } from './DebatePanel';

/** The stored debate, shaped for the debate panel. */
export function toDebateView(row: NonNullable<Awaited<ReturnType<typeof getDebate>>>): DebateView {
  return {
    id: row.id,
    topic: row.topic,
    hypothesis: row.hypothesis,
    status: row.status,
    phase: row.phase,
    isMock: row.isMock,
    rounds: row.rounds,
    seed: row.seed,
    cohortName: row.cohort.name,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    spendUsd: row.spendUsd,
    failureReason: row.failureReason,
    agents: (row.agents ?? []) as unknown as DebateView['agents'],
    evidence: (row.evidence ?? null) as unknown as DebateView['evidence'],
    metrics: (row.metrics ?? null) as unknown as DebateView['metrics'],
    conclusion: (row.conclusion ?? null) as unknown as DebateView['conclusion'],
    turns: row.turns.map((t) => ({
      seq: t.seq,
      round: t.round,
      phase: t.phase,
      agentKey: t.agentKey,
      agentName: t.agentName,
      agentRole: t.agentRole,
      stance: t.stance,
      confidence: t.confidence,
      addressedTo: t.addressedTo,
      content: t.content as Record<string, unknown>,
      ok: t.ok,
    })),
  };
}
