import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installDom } from './setup-dom';
import { ev, call, runEv } from '../unit/telemetry-fixtures';
import { pipelineFromVersionStatus, reduceFlow, reducePipeline } from '../../src/telemetry/reduce';
import { ProcessingPipeline } from '../../src/ui/components/ProcessingPipeline';
import { DataFlowVisualization } from '../../src/ui/components/DataFlowVisualization';
import { ConnectionStatus } from '../../src/ui/components/ConnectionStatus';
import { PassFlagFailSummary } from '../../src/ui/components/PassFlagFailSummary';
import { SegmentDistributionBar } from '../../src/ui/components/SegmentDistributionBar';
import { ErrorState } from '../../src/ui/components/States';
import { ReportModeLayout } from '../../src/ui/components/ReportModeLayout';
import { WorkflowStepper } from '../../src/ui/shell/WorkflowStepper';
import { PreliminaryFindingsPanel } from '../../src/ui/components/PreliminaryFindingsPanel';
import { MetricCard } from '../../src/ui/components/MetricCard';
import { FixtureTransport } from '../../src/ui/live/transport';
import { useTelemetryStream } from '../../src/ui/live/useTelemetryStream';
import { TelemetryEventSchema } from '../../src/telemetry/contract';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

beforeEach(() => installDom());
afterEach(cleanup);

describe('ProcessingPipeline', () => {
  it('shows each stage with its state in words and a textual summary', () => {
    const p = reducePipeline([
      ev({ stage: 'upload_received', status: 'completed' }),
      ev({ stage: 'safety_scan', status: 'skipped' }),
      ev({ stage: 'parsing', status: 'failed', message: 'Nothing could be read.' }),
    ]);
    render(<ProcessingPipeline pipeline={p} />);
    expect(screen.getByText(/Failed at: Parsing/)).toBeInTheDocument();
    const parsing = screen.getByText('Parsing').closest('li')!;
    expect(parsing).toHaveAttribute('data-stage-status', 'failed');
    expect(within(parsing).getByText('Nothing could be read.')).toBeInTheDocument();
    expect(screen.getByText('Safety scan').closest('li')).toHaveAttribute('data-stage-status', 'not_performed');
    expect(screen.getByText('Schema detection').closest('li')).toHaveAttribute('data-stage-status', 'pending');
  });

  it('says when states are reconstructed rather than recorded', () => {
    render(<ProcessingPipeline pipeline={pipelineFromVersionStatus('READY_FOR_REVIEW', { approved: false, scanned: false })} />);
    expect(screen.getByText(/states are reconstructed/)).toBeInTheDocument();
  });
});

describe('DataFlowVisualization', () => {
  it('animates only the connector into the active node, and not under reduced motion', () => {
    const nodes = reduceFlow(reducePipeline([ev({ stage: 'upload_received', status: 'completed' }), ev({ stage: 'parsing', status: 'active' })]));
    const { container, unmount } = render(<DataFlowVisualization nodes={nodes} />);
    // useReducedMotion starts true on first render, then reads the OS preference.
    expect(container.querySelectorAll('.motion-flow').length).toBeLessThanOrEqual(1);
    expect(screen.getByText(/Parsing: Active/)).toBeInTheDocument();
    unmount();
    installDom({ reducedMotion: true });
    const r = render(<DataFlowVisualization nodes={nodes} />);
    expect(r.container.querySelectorAll('.motion-flow')).toHaveLength(0);
    expect(r.container.querySelectorAll('.motion-live')).toHaveLength(0);
  });
});

describe('ConnectionStatus', () => {
  it.each([
    ['live', 'Live'],
    ['polling', 'Polling'],
    ['reconnecting', 'Reconnecting'],
    ['offline', 'Offline'],
    ['closed', 'Up to date'],
    ['fixture', 'Fixture'],
  ] as const)('%s reads as %s', (state, word) => {
    render(<ConnectionStatus state={state} />);
    expect(screen.getByText(word)).toBeInTheDocument();
  });
});

describe('PassFlagFailSummary', () => {
  it('shows counts, shares and the threshold source', () => {
    render(<PassFlagFailSummary pass={6} flag={1} fail={1} />);
    expect(screen.getByText('8 evaluated')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText(/validated against its Zod schema/)).toBeInTheDocument();
    expect(screen.getAllByText('Not evaluated')).toHaveLength(1);
  });
  it('states unavailability instead of showing zeros', () => {
    render(<PassFlagFailSummary pass={0} flag={0} fail={0} unavailableReason="No calls were recorded." />);
    expect(screen.getByText(/Unavailable: No calls were recorded/)).toBeInTheDocument();
  });
});

describe('SegmentDistributionBar', () => {
  it('draws labelled bars and switches to an equivalent table', async () => {
    render(<SegmentDistributionBar title="Segment" rows={[{ key: 'a', label: '18-24', count: 30, confidence: 'HIGH' }, { key: 'b', label: '25-34', count: 10 }]} />);
    expect(screen.getByText(/18-24: 30 \(75%\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Table view' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '25-34' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chart view' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ErrorState', () => {
  it('states cause, remedy and correlation, and retries', async () => {
    const retry = vi.fn();
    render(<ErrorState title="Stopped" cause="The file could not be read." remedy="Upload it again." correlationId="job_123" onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The file could not be read.');
    expect(screen.getByText(/correlation job_123/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('MetricCard', () => {
  it('says Unavailable rather than 0 when a metric cannot be calculated', () => {
    render(<dl><MetricCard label="Throughput" value={null} definition="Answers per minute." /></dl>);
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });
});

describe('ReportModeLayout', () => {
  it('keeps brand, date, configuration and the simulation notice', () => {
    render(
      <ReportModeLayout title="Report" projectName="CBGA" generatedAt="2026-09-21 08:00 UTC" isMock config={[{ label: 'Seeds', value: '42' }]}>
        <p>Body</p>
      </ReportModeLayout>,
    );
    expect(screen.getByText('Persona Intelligence')).toBeInTheDocument();
    expect(screen.getByText(/Generated 2026-09-21/)).toBeInTheDocument();
    expect(screen.getByText('Seeds')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Simulation notice' })).toHaveTextContent(/Mock provider/);
  });
});

describe('WorkflowStepper', () => {
  it('states completion, blocking reasons, unresolved counts and last save for every step', () => {
    const base = { unresolved: 0, lastSavedAt: null, reason: null };
    render(
      <WorkflowStepper
        projectId="p1"
        current="PERSONAS"
        state={{
          DATA: { ...base, status: 'complete', lastSavedAt: '2026-09-21T08:00:00.000Z' },
          BRIEF: { ...base, status: 'warning', reason: 'No market is named.', unresolved: 2 },
          PERSONAS: { ...base, status: 'running' },
          SIMULATION: { ...base, status: 'blocked', reason: 'Needs an approved cohort.' },
          RESULTS: { ...base, status: 'error', reason: 'The most recent run failed.' },
        }}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Project workflow' });
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links[2]).toHaveAttribute('aria-current', 'step');
    // 08:00 UTC is 16:00 in GMT+8, the zone the interface shows.
    expect(links[0]).toHaveTextContent(/Complete.*saved 2026-09-21 16:00 GMT\+8/);
    expect(links[1]).toHaveTextContent(/2 unresolved item/);
    expect(links[3]).toHaveTextContent(/Blocked.*Needs an approved cohort/);
    expect(links[4]).toHaveTextContent(/Error/);
  });
});

describe('PreliminaryFindingsPanel', () => {
  it('labels emerging figures as preliminary and replaces them once the run completes', () => {
    const tally = { processed: 2, total: 8, confirm: 1, dispute: 1, abstain: 0, superseded: false };
    const { rerender } = render(<PreliminaryFindingsPanel tally={tally} resultsHref="/r" completed={false} />);
    expect(screen.getByText('Preliminary')).toBeInTheDocument();
    expect(screen.getByText(/subject to change/)).toBeInTheDocument();
    rerender(<PreliminaryFindingsPanel tally={tally} resultsHref="/r" completed />);
    expect(screen.queryByText('Preliminary')).not.toBeInTheDocument();
    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the results' })).toHaveAttribute('href', '/r');
  });
});

describe('useTelemetryStream with the fixture provider', () => {
  function Probe({ transport }: { transport: FixtureTransport }) {
    const s = useTelemetryStream({ projectId: 'p1', scope: { runId: 'r1' }, initialEvents: [], initialSnapshot: null, transport, flushMs: 0 });
    return <p data-testid="probe">{`${s.connection}|${s.events.length}|${s.events.map((e) => e.seq).join(',')}|${s.events.every((e) => e.isMock)}`}</p>;
  }
  it('labels itself as a fixture, marks events mock, and de-duplicates and orders them', async () => {
    const a = runEv({ stage: 'REVISION', status: 'active', seq: 5 });
    const b = call('REVISION', 'A', 'pass');
    const t = new FixtureTransport([[{ ...b, seq: 7 }, a], [a]]);
    render(<Probe transport={t} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByTestId('probe')).toHaveTextContent('fixture|2|5,7|true');
  });
  it('emits events that satisfy the same contract as live events', () => {
    const t = new FixtureTransport([[call('REVISION', 'A', 'pass')]]);
    const got: unknown[] = [];
    t.start({ onEvents: (e) => got.push(...e), onSnapshot: () => {}, onStatus: () => {} });
    expect(got.every((e) => TelemetryEventSchema.safeParse(e).success)).toBe(true);
  });
});
