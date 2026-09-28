import { describe, expect, it } from 'vitest';
import { NODE_STATUS_META, PERSONA_ACTIVITY_META, VERDICT_META, findingSeverity } from '../../src/telemetry/status';
import { motionFor } from '../../src/ui/live/useReducedMotion';
import { cohortStats } from '../../src/ui/cohort/stats';
import { verdictsFromCalls } from '../../src/report/summary';

describe('status to label, icon and tone', () => {
  it.each(Object.entries({ ...NODE_STATUS_META, ...VERDICT_META, ...PERSONA_ACTIVITY_META }))('%s has words and an icon, never colour alone', (_k, m) => {
    expect(m.label.length).toBeGreaterThan(1);
    expect(m.icon).toBeTruthy();
    expect(m.description.length).toBeGreaterThan(5);
  });

  it('pulses only for work actually in progress', () => {
    expect(NODE_STATUS_META.active.live).toBe(true);
    expect(NODE_STATUS_META.awaiting.live).toBe(false);
    expect(NODE_STATUS_META.completed.live).toBe(false);
    expect(NODE_STATUS_META.failed.live).toBe(false);
  });

  it('gives pass, flag and fail distinct tones and icons', () => {
    const set = new Set([VERDICT_META.pass, VERDICT_META.flag, VERDICT_META.fail].map((m) => `${m.tone}/${m.icon}`));
    expect(set.size).toBe(3);
  });
});

describe('finding severity', () => {
  it('uses a stored severity when present', () => {
    expect(findingSeverity({ severity: 'critical', classification: 'PROBABLE', groupthink: false })).toEqual({ level: 'critical', derived: false });
  });
  it('derives by the stated rule otherwise, and says it is derived', () => {
    expect(findingSeverity({ severity: null, classification: 'PROBABLE', groupthink: true })).toEqual({ level: 'high', derived: true });
    expect(findingSeverity({ severity: null, classification: 'CONTESTED', groupthink: false }).level).toBe('medium');
    expect(findingSeverity({ severity: null, classification: 'PROBABLE', groupthink: false }).level).toBe('low');
    expect(findingSeverity({ severity: null, classification: 'DISCARDED', groupthink: false }).level).toBe('informational');
  });
});

describe('reduced-motion logic', () => {
  it('turns off flow animation and pulse and uses instant scrolling', () => {
    expect(motionFor(true)).toEqual({ scrollBehavior: 'auto', animateFlow: false, pulse: false, enterClass: '' });
    expect(motionFor(false).animateFlow).toBe(true);
  });
});

describe('cohort statistics', () => {
  it('counts approval, weak evidence and data coverage from stored attributes', () => {
    const s = cohortStats([
      { name: 'A', segment: 'x', baseSize: 100, weight: 0.6, confidence: 'HIGH', approval: 'APPROVED', attributes: [{ origin: 'OBSERVED', group: 'g' }, { origin: 'SIMULATED', group: 'g' }] },
      { name: 'B', segment: 'y', baseSize: 10, weight: 0.4, confidence: 'LOW', approval: 'CANDIDATE', contradictions: 1, attributes: [{ origin: 'DERIVED', group: 'g' }, { origin: 'SIMULATED', group: 'g' }] },
    ]);
    expect([s.total, s.approved, s.pending, s.weakEvidence, s.conflicting, s.segments]).toEqual([2, 1, 1, 1, 1, 2]);
    expect(s.dataCoverage).toBeCloseTo(0.5);
    expect(s.sampleCoverage).toBeCloseTo(1);
  });
});

describe('verdicts from recorded calls', () => {
  it('counts one verdict per answer, not per attempt', () => {
    const v = verdictsFromCalls([
      { stage: 'S', personaKey: 'A', attempt: 1, outcome: 'ok', schemaValid: true },
      { stage: 'S', personaKey: 'B', attempt: 1, outcome: 'invalid', schemaValid: false },
      { stage: 'S', personaKey: 'B', attempt: 2, outcome: 'ok', schemaValid: true },
      { stage: 'S', personaKey: 'C', attempt: 1, outcome: 'refused', schemaValid: false },
    ]);
    expect(v).toEqual({ pass: 1, flag: 1, fail: 1 });
  });
});
