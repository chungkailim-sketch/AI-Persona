import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityFeed } from '../../src/ui/components/ActivityFeed';
import { installDom } from './setup-dom';
import { call, runEv } from '../unit/telemetry-fixtures';

const feed = () => within(screen.getByRole('list'));

describe('ActivityFeed', () => {
  beforeEach(() => installDom());
  afterEach(cleanup);

  const base = [
    runEv({ stage: 'INDEPENDENT_ASSESSMENT', status: 'active', message: 'Each persona answers alone.' }),
    call('INDEPENDENT_ASSESSMENT', 'PERSONA-0017', 'flag', { observation: 'Reviews message variant B', action: 'Flags unclear product benefit', evaluation: 'Clarity threshold not met', score: 0.44, stepIndex: 3, stepTotal: 8 }),
    call('INDEPENDENT_ASSESSMENT', 'PERSONA-0002', 'pass', { observation: 'Assessed H1', action: 'Stance: confirm', evaluation: 'ok', score: 0.8, stepIndex: 3 }),
  ];

  it('renders the observation → action → evaluation → result pattern', () => {
    render(<ActivityFeed events={base} />);
    const row = feed().getByText('PERSONA-0017').closest('li')!;
    expect(within(row).getByText('Reviews message variant B')).toBeInTheDocument();
    expect(within(row).getByText('Flags unclear product benefit')).toBeInTheDocument();
    expect(within(row).getByText(/Flag · 0\.44/)).toBeInTheDocument();
    expect(within(row).getByText(/Step 3\/8/)).toBeInTheDocument();
  });

  it('expands and collapses a row with the button state exposed', async () => {
    render(<ActivityFeed events={base} />);
    const toggles = screen.getAllByRole('button', { name: /Expand event details/ });
    await userEvent.click(toggles[1]!);
    expect(screen.getByRole('button', { name: /Collapse event details/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Copy safe details/ })).toBeInTheDocument();
  });

  it('filters by persona, status and search text', async () => {
    render(<ActivityFeed events={base} />);
    await userEvent.selectOptions(screen.getByLabelText('Persona'), 'PERSONA-0002');
    expect(feed().queryByText('PERSONA-0017')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Persona'), 'all');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'problems');
    expect(feed().getByText('PERSONA-0017')).toBeInTheDocument();
    expect(feed().queryByText('PERSONA-0002')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'all');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search activity' }), 'unclear');
    expect(feed().queryByText('PERSONA-0002')).not.toBeInTheDocument();
  });

  it('counts new events while auto-scroll is off, and jumps back on request', async () => {
    const { rerender } = render(<ActivityFeed events={base} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auto-scroll' }));
    const more = [...base, call('REVISION', 'PERSONA-0003', 'pass', {}, 1), call('REVISION', 'PERSONA-0004', 'pass', {}, 2)];
    act(() => rerender(<ActivityFeed events={more} />));
    const jump = screen.getByRole('button', { name: /2 new events/ });
    await userEvent.click(jump);
    expect(screen.queryByRole('button', { name: /new event/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Auto-scroll' })).toBeChecked();
  });

  it('pauses the display without dropping events, and resumes to show them', async () => {
    const { rerender } = render(<ActivityFeed events={base} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pause display' }));
    const more = [...base, call('REVISION', 'PERSONA-0099', 'pass', {}, 1)];
    act(() => rerender(<ActivityFeed events={more} />));
    expect(feed().queryByText('PERSONA-0099')).not.toBeInTheDocument();
    expect(screen.getByText(/display paused, the run continues/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resume display' }));
    expect(feed().getByText('PERSONA-0099')).toBeInTheDocument();
  });

  it('never renders more than the render limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => call('REVISION', `P-${i}`, 'pass', {}, i + 1, 50));
    render(<ActivityFeed events={many} renderLimit={10} />);
    expect(screen.getByText(/Showing 10 of 50 matching/)).toBeInTheDocument();
  });
});
