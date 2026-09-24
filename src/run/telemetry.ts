/**
 * Run telemetry: the orchestrator's side of the live stream.
 *
 * Summaries are written from templates filled with structured outputs — a stance, a confidence, a
 * count — never from a model's free text. The rationale a persona gave, its verbatim reaction and
 * the text of a challenge stay in the database behind the report's permissions; the stream says
 * only what kind of thing happened and how it was evaluated.
 */
import { emitTelemetry, type EmitInput } from '@/telemetry/emit';
import type { CallResult } from '@/model/client';
import type { Verdict } from '@/telemetry/reduce';

export function verdictFor(result: Pick<CallResult<unknown>, 'ok' | 'attempts'>): Verdict {
  if (!result.ok) return 'fail';
  return result.attempts > 1 ? 'flag' : 'pass';
}

const EVALUATION_TEXT: Record<Verdict, string> = {
  pass: 'Answer matched the required shape first time',
  flag: 'Answer matched the required shape only after a repair attempt',
  fail: 'No usable answer',
};

export interface CallSummary {
  observation: string;
  action: string;
  stance?: string;
  confidence?: number;
  evidenceCount?: number;
}

export function runTelemetry(runId: string, projectId: string, isMock: boolean) {
  const base = { sourceType: 'run' as const, sourceId: runId, projectId, runId, isMock };
  const send = (e: Omit<EmitInput, 'sourceType' | 'sourceId' | 'projectId' | 'runId' | 'isMock'>) =>
    emitTelemetry({ ...base, ...e });

  return {
    send,
    stage(stage: string, status: EmitInput['status'], message: string, extra: Partial<EmitInput> = {}) {
      return send({ eventType: 'run.stage', stage, status, message, ...extra });
    },
    callStarted(stage: string, personaKey: string, attempt: number, index: number, total: number, stepIndex: number) {
      return send({
        eventType: 'run.call.started',
        stage,
        status: 'active',
        message: attempt > 1 ? `${personaKey}: repair attempt ${attempt}.` : `${personaKey}: call started.`,
        progressCurrent: index - 1,
        progressTotal: total,
        safeMetadata: { personaKey, attempt, stepIndex, stepTotal: 8 },
      });
    },
    callCompleted(
      stage: string,
      personaKey: string,
      index: number,
      total: number,
      stepIndex: number,
      result: Pick<CallResult<unknown>, 'ok' | 'attempts' | 'outcome' | 'inputTokens' | 'outputTokens' | 'costUsd' | 'latencyMs'>,
      summary: CallSummary,
    ) {
      const verdict = verdictFor(result);
      return send({
        eventType: 'run.call.completed',
        stage,
        status: verdict === 'fail' ? 'warning' : 'completed',
        severity: verdict === 'fail' ? 'warning' : verdict === 'flag' ? 'notice' : 'info',
        message: `${personaKey}: ${summary.action}`,
        progressCurrent: index,
        progressTotal: total,
        metricName: summary.confidence !== undefined ? 'stated_confidence' : null,
        metricValue: summary.confidence ?? null,
        safeMetadata: {
          personaKey,
          stepIndex,
          stepTotal: 8,
          observation: summary.observation,
          action: verdict === 'fail' ? `No usable answer (${result.outcome})` : summary.action,
          evaluation: EVALUATION_TEXT[verdict],
          verdict,
          score: summary.confidence ?? null,
          confidence: summary.confidence ?? null,
          stance: summary.stance ?? null,
          evidenceCount: summary.evidenceCount ?? null,
          attempt: result.attempts,
          outcome: result.outcome,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
        },
      });
    },
  };
}
