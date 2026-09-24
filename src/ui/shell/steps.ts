/** The five-step workflow. Order and identity live here so nav, indicator and guards agree. */
export const WORKFLOW_STEPS = [
  { key: 'DATA', index: 1, label: 'Source data', href: 'data', description: 'Ingest evidence and clear it for use' },
  { key: 'BRIEF', index: 2, label: 'Brief', href: 'brief', description: 'State the question and what is being tested' },
  { key: 'PERSONAS', index: 3, label: 'Personas', href: 'personas', description: 'Generate and approve the cohort' },
  { key: 'SIMULATION', index: 4, label: 'Simulation', href: 'simulate', description: 'Configure, confirm and run' },
  { key: 'RESULTS', index: 5, label: 'Results', href: 'results', description: 'Read findings and decide' },
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
