/**
 * The five-step journey: data → brief → cast → roundtable → report. The URLs predate the journey and
 * are kept; the earlier research tools for each step live under /advanced. Order and identity live
 * here so nav, indicator and guards agree.
 */
export const WORKFLOW_STEPS = [
  { key: 'DATA', index: 1, label: 'Data', href: 'data', description: 'Upload the survey databooks' },
  { key: 'BRIEF', index: 2, label: 'Brief', href: 'brief', description: 'Markets, question and categories' },
  { key: 'PERSONAS', index: 3, label: 'Cast', href: 'personas', description: 'Markets × income tiers' },
  { key: 'SIMULATION', index: 4, label: 'Roundtable', href: 'simulate', description: 'Every persona answers' },
  { key: 'RESULTS', index: 5, label: 'Report', href: 'results', description: 'Slides and PDF' },
] as const;

export type StepKey = (typeof WORKFLOW_STEPS)[number]['key'];

/** A step is never merely "inert" — a blocked step always carries a reason (FR-83). */
export type StepState =
  | { status: 'complete' }
  | { status: 'current' }
  | { status: 'available' }
  | { status: 'warning'; reason: string }
  | { status: 'blocked'; reason: string };

export type StepStates = Record<StepKey, StepState>;

export function stepByKey(key: StepKey) {
  const s = WORKFLOW_STEPS.find((x) => x.key === key);
  if (!s) throw new Error(`Unknown step ${key}`);
  return s;
}
