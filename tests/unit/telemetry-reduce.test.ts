import { describe, expect, it } from 'vitest';
import {
  aggregateRunMetrics,
  announcementFor,
  applyToNode,
  effectiveRunStatus,
  pipelineFromVersionStatus,
  preliminaryTally,
  reduceDebateStages,
  reduceFlow,
  reducePersonaActivity,
  reducePipeline,
  reduceRunStages,
} from '../../src/telemetry/reduce';
import { call, ev, runEv } from './telemetry-fixtures';

describe('pipeline state transitions', () => {
  it('starts every stage pending and says so', () => {
    const p = reducePipeline([]);
    expect(p.source).toBe('empty');
    expect(Object.values(p.stages).every((s) => s.status === 'pending')).toBe(true);
  });

  it('moves a stage through active to completed only on events', () => {
    const p = reducePipeline([ev({ stage: 'parsing', status: 'active' }), ev({ stage: 'parsing', status: 'completed' })]);
    expect(p.stages.parsing.status).toBe('completed');
    expect(p.stages.schema_detection.status).toBe('pending');
    expect(p.completedCount).toBe(1);
  });

  it('keeps a warning when a later completion arrives', () => {
    const p = reducePipeline([ev({ stage: 'parsing', status: 'warning' }), ev({ stage: 'parsing', status: 'completed' })]);
    expect(p.stages.parsing.status).toBe('warning');
    expect(p.stages.parsing.warnings).toBe(1);
  });

  it('marks a failure, and a retryable failure distinctly, and stops there', () => {
    const failed = reducePipeline([ev({ stage: 'parsing', status: 'failed' })]);
    expect(failed.failed).toBe('parsing');
    expect(failed.stages.parsing.status).toBe('failed');
    expect(failed.stages.schema_detection.status).toBe('pending');
    const retry = reducePipeline([ev({ stage: 'parsing', status: 'failed', retryable: true })]);
    expect(retry.stages.parsing.status).toBe('retryable');
  });

  it('treats a stage started again after failure as a retry in progress', () => {
    const p = reducePipeline([ev({ stage: 'parsing', status: 'failed' }), ev({ stage: 'parsing', status: 'active' })]);
    expect(p.stages.parsing.status).toBe('active');
    expect(p.failed).toBeNull();
  });

  it('records a skipped check as not performed, and a human gate as awaiting', () => {
    const p = reducePipeline([ev({ stage: 'safety_scan', status: 'skipped' }), ev({ stage: 'import_approved', status: 'pending' })]);
    expect(p.stages.safety_scan.status).toBe('not_performed');
    expect(p.stages.import_approved.status).toBe('awaiting');
  });

  it('supports cancellation', () => {
    expect(applyToNode({ status: 'active', message: null, count: null, warnings: 0, updatedAt: null }, ev({ stage: 'parsing', status: 'cancelled' })).status).toBe('cancelled');
  });

  it('ignores events for other sources and unknown stages', () => {
    const p = reducePipeline([runEv({ stage: 'parsing', status: 'active' }), ev({ stage: 'job', status: 'failed' })]);
    expect(p.source).toBe('empty');
  });

  it('reconstructs from a recorded status and labels the source', () => {
    const p = pipelineFromVersionStatus('READY_FOR_REVIEW', { approved: false, scanned: false });
    expect(p.source).toBe('status');
    expect(p.stages.safety_scan.status).toBe('not_performed');
    expect(p.stages.ready_for_review.status).toBe('completed');
    expect(p.stages.import_approved.status).toBe('awaiting');
    const approved = pipelineFromVersionStatus('READY_FOR_REVIEW', { approved: true, scanned: false });
    expect(approved.stages.import_approved.status).toBe('completed');
    expect(pipelineFromVersionStatus('FAILED', { approved: false, scanned: false }).failed).toBe('parsing');
  });
});

describe('data-flow collapse', () => {
  it('is only as far along as its least-advanced stage', () => {
    const flow = reduceFlow(reducePipeline([ev({ stage: 'upload_received', status: 'completed' }), ev({ stage: 'parsing', status: 'active' })]));
    expect(flow.find((n) => n.key === 'source')!.status).toBe('completed');
    expect(flow.find((n) => n.key === 'parsing')!.status).toBe('active');
    expect(flow.find((n) => n.key === 'profiling')!.status).toBe('pending');
  });

  it('shows a failure on the node that owns the failed stage', () => {
    const flow = reduceFlow(reducePipeline([ev({ stage: 'outlier_analysis', status: 'failed' })]));
    expect(flow.find((n) => n.key === 'profiling')!.status).toBe('failed');
  });
});

describe('run reductions', () => {
  const events = [
    runEv({ stage: 'INDEPENDENT_ASSESSMENT', status: 'active', progressTotal: 3 }),
    call('INDEPENDENT_ASSESSMENT', 'A', 'pass', { confidence: 0.8, stance: 'confirm' }, 1),
    call('INDEPENDENT_ASSESSMENT', 'B', 'flag', { confidence: 0.4, stance: 'dispute' }, 2),
    call('INDEPENDENT_ASSESSMENT', 'C', 'fail', {}, 3),
  ];

  it('aggregates pass, flag and fail and their rates', () => {
    const m = aggregateRunMetrics(events, null, Date.parse(events[3]!.timestamp));
    expect([m.pass, m.flag, m.fail]).toEqual([1, 1, 1]);
    expect(m.passRate).toBeCloseTo(1 / 3);
    expect(m.retries).toBe(1);
    expect(m.meanConfidence).toBeCloseTo(0.6);
    expect(m.inputTokens).toBe(300);
    expect(m.stageProgress).toEqual({ current: 3, total: 3 });
  });

  it('never reports throughput for a run that is not active', () => {
    const snapshot = { id: 'r1', status: 'COMPLETED', isMock: true, startedAt: null, completedAt: null, cancelRequested: false, failureReason: null, calls: 3, inputTokens: 999, outputTokens: 1, costUsd: 0, steps: [] };
    const m = aggregateRunMetrics(events, snapshot, Date.now());
    expect(m.callsPerMinute).toBeNull();
    expect(m.inputTokens).toBe(999); // the snapshot, summed from ModelCall, wins for accounting
  });

  it('lets the snapshot override event-derived stage states on reconnection', () => {
    const stages = reduceRunStages([runEv({ stage: 'REVISION', status: 'active' })], {
      id: 'r1', status: 'SYNTHESIS', isMock: true, startedAt: null, completedAt: null, cancelRequested: false, failureReason: null, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0,
      steps: [{ stage: 'REVISION', status: 'completed', durationMs: 5 }, { stage: 'SYNTHESIS', status: 'running', durationMs: null }],
    });
    expect(stages.REVISION.status).toBe('completed');
    expect(stages.SYNTHESIS.status).toBe('active');
  });

  it('derives persona activity only from events that name the persona', () => {
    const started = runEv({ stage: 'REVISION', status: 'active', eventType: 'run.call.started', safeMetadata: { personaKey: 'A', attempt: 1 } });
    const repair = runEv({ stage: 'REVISION', status: 'active', eventType: 'run.call.started', safeMetadata: { personaKey: 'B', attempt: 2 } });
    const s = reducePersonaActivity([...events, runEv({ stage: 'REVISION', status: 'active' }), started, repair], ['A', 'B', 'C', 'D'], 'REVISION');
    expect(s.get('A')).toBe('revising');
    expect(s.get('B')).toBe('retrying');
    expect(s.get('D')).toBe('waiting');
    const done = reducePersonaActivity(events, ['A', 'B', 'C'], 'COMPLETED');
    expect(done.get('A')).toBe('completed');
    expect(done.get('C')).toBe('failed');
  });

  it('maps the nine method stages onto the orchestrator stage that performs them', () => {
    const stages = reduceRunStages(events, null);
    const debate = reduceDebateStages(stages, events);
    expect(debate).toHaveLength(9);
    const citation = debate.find((d) => d.key === 'evidence_citation')!;
    expect(citation.performedWithin).toMatch(/Independent assessment/);
    expect(debate.find((d) => d.key === 'independent_assessment')!.participants).toBe(3);
  });

  it('labels the independent tally preliminary until the report stage completes', () => {
    const t = preliminaryTally(events)!;
    expect([t.confirm, t.dispute, t.processed, t.total, t.superseded]).toEqual([1, 1, 2, 3, false]);
    const done = preliminaryTally([...events, runEv({ stage: 'REPORT', status: 'completed' })])!;
    expect(done.superseded).toBe(true);
  });

  it('takes a terminal event before the next snapshot arrives, but a terminal snapshot always wins', () => {
    expect(effectiveRunStatus([runEv({ stage: 'run', status: 'completed', eventType: 'run.completed' })], 'REVISION')).toBe('COMPLETED');
    expect(effectiveRunStatus([runEv({ stage: 'SYNTHESIS', status: 'active' })], 'REVISION')).toBe('SYNTHESIS');
    expect(effectiveRunStatus([runEv({ stage: 'SYNTHESIS', status: 'active' })], 'FAILED')).toBe('FAILED');
  });

  it('announces stage changes and endings, and nothing else', () => {
    expect(announcementFor({ stage: 'A', status: 'REVISION' }, { stage: 'B', status: 'REVISION', stageLabel: 'Bee' })).toBe('Now in stage: Bee.');
    expect(announcementFor({ stage: 'A', status: 'REVISION' }, { stage: 'A', status: 'REVISION' })).toBeNull();
    expect(announcementFor({ stage: 'A', status: 'REVISION' }, { stage: null, status: 'FAILED' })).toBe('The run failed.');
  });
});
