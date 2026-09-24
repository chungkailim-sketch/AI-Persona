/**
 * Status → presentation. One table, so a status reads the same on every screen and is never
 * carried by colour alone: each has a word, an icon shape and a tone, and the tone maps to
 * semantic tokens that are defined for both themes.
 */
import type { NodeStatus, PersonaActivity, Verdict } from './reduce';

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'pending' | 'neutral' | 'brand';
export type IconName =
  | 'check'
  | 'alert'
  | 'cross'
  | 'dot'
  | 'live'
  | 'minus'
  | 'retry'
  | 'slash'
  | 'clock'
  | 'flag'
  | 'hand';

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: IconName;
  /** Whether a restrained pulse is appropriate. Only for work genuinely in progress. */
  live: boolean;
  description: string;
}

export const NODE_STATUS_META: Record<NodeStatus, StatusMeta> = {
  pending: { label: 'Pending', tone: 'pending', icon: 'dot', live: false, description: 'Not started.' },
  active: { label: 'Active', tone: 'info', icon: 'live', live: true, description: 'In progress now.' },
  completed: { label: 'Completed', tone: 'ok', icon: 'check', live: false, description: 'Finished without warnings.' },
  warning: { label: 'Completed with warnings', tone: 'warn', icon: 'alert', live: false, description: 'Finished; something needs review.' },
  failed: { label: 'Failed', tone: 'danger', icon: 'cross', live: false, description: 'Stopped. Later stages did not run.' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'slash', live: false, description: 'Stopped on request.' },
  retryable: { label: 'Failed — retryable', tone: 'danger', icon: 'retry', live: false, description: 'Stopped; it can be retried.' },
  not_performed: { label: 'Not performed', tone: 'warn', icon: 'minus', live: false, description: 'This check did not run in this build.' },
  awaiting: { label: 'Waiting for a person', tone: 'brand', icon: 'hand', live: false, description: 'Nothing is running; the next step is a human decision.' },
};

export type EvaluationState = Verdict | 'pending' | 'not_evaluated' | 'unavailable';

export const VERDICT_META: Record<EvaluationState, StatusMeta> = {
  pass: { label: 'Pass', tone: 'ok', icon: 'check', live: false, description: 'Answer matched its required shape on the first attempt.' },
  flag: { label: 'Flag', tone: 'warn', icon: 'flag', live: false, description: 'Answer matched its shape only after a repair attempt.' },
  fail: { label: 'Fail', tone: 'danger', icon: 'cross', live: false, description: 'No usable answer: invalid, refused, timed out or errored.' },
  pending: { label: 'Pending', tone: 'pending', icon: 'clock', live: false, description: 'Not evaluated yet.' },
  not_evaluated: { label: 'Not evaluated', tone: 'neutral', icon: 'minus', live: false, description: 'This item is not subject to evaluation.' },
  unavailable: { label: 'Unavailable', tone: 'neutral', icon: 'slash', live: false, description: 'The data needed to evaluate this was not recorded.' },
};

/** Where the pass / flag / fail thresholds come from — shown next to every summary of them. */
export const VERDICT_THRESHOLD_SOURCE =
  'Each model answer is validated against its Zod schema (src/run/schemas.ts). Pass: valid first time. ' +
  'Flag: valid only after one repair attempt. Fail: no valid answer. This measures answer shape, not the quality of the reasoning.';

export const PERSONA_ACTIVITY_META: Record<PersonaActivity, StatusMeta> = {
  waiting: { label: 'Waiting', tone: 'pending', icon: 'clock', live: false, description: 'Not yet reached in the current stage.' },
  evaluating: { label: 'Evaluating', tone: 'info', icon: 'live', live: true, description: 'Independent assessment call in flight.' },
  responding: { label: 'Responding', tone: 'info', icon: 'live', live: true, description: 'Reacting to the stimulus.' },
  challenging: { label: 'Challenging', tone: 'info', icon: 'live', live: true, description: 'Arguing against the majority view.' },
  revising: { label: 'Revising', tone: 'info', icon: 'live', live: true, description: 'Reconsidering its position.' },
  retrying: { label: 'Retrying', tone: 'warn', icon: 'retry', live: true, description: 'First answer failed its shape; repair attempt in flight.' },
  scored: { label: 'Scored', tone: 'ok', icon: 'check', live: false, description: 'Answered in the current stage.' },
  completed: { label: 'Completed', tone: 'ok', icon: 'check', live: false, description: 'Finished every stage it took part in.' },
  failed: { label: 'Failed', tone: 'danger', icon: 'cross', live: false, description: 'Its last answer was unusable.' },
};

export const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low', 'informational'] as const;
export type FindingSeverity = (typeof SEVERITY_LEVELS)[number];

export const SEVERITY_META: Record<FindingSeverity, StatusMeta> = {
  critical: { label: 'Critical', tone: 'danger', icon: 'alert', live: false, description: 'Would change the decision if ignored.' },
  high: { label: 'High', tone: 'danger', icon: 'flag', live: false, description: 'Materially weakens the conclusion.' },
  medium: { label: 'Medium', tone: 'warn', icon: 'flag', live: false, description: 'Qualifies the conclusion.' },
  low: { label: 'Low', tone: 'info', icon: 'dot', live: false, description: 'Worth noting; unlikely to change the decision.' },
  informational: { label: 'Informational', tone: 'neutral', icon: 'minus', live: false, description: 'Context only.' },
};

/**
 * Severity for a panel finding. A stored severity wins. Otherwise it is derived by a fixed, stated
 * rule from the classification the orchestrator computed — never from wording, and the screen
 * labels it "derived" so nobody mistakes it for a reviewer's judgement.
 */
export function findingSeverity(input: {
  severity: string | null | undefined;
  classification: string | null | undefined;
  groupthink: boolean;
}): { level: FindingSeverity; derived: boolean } {
  const stored = input.severity?.toLowerCase();
  if (stored && (SEVERITY_LEVELS as readonly string[]).includes(stored)) {
    return { level: stored as FindingSeverity, derived: false };
  }
  if (input.groupthink) return { level: 'high', derived: true };
  switch (input.classification) {
    case 'CONTESTED':
    case 'MINORITY_RETAINED':
      return { level: 'medium', derived: true };
    case 'PROBABLE':
      return { level: 'low', derived: true };
    default:
      return { level: 'informational', derived: true };
  }
}

export const SEVERITY_RULE =
  'Derived when no reviewer set one: herding detected → High; contested or minority-retained → Medium; ' +
  'probable → Low; otherwise Informational.';
