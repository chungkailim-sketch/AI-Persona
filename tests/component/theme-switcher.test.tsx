import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemePreferenceControl, ThemeSwitcher } from '../../src/ui/shell/ThemeSwitcher';
import { installDom } from './setup-dom';

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    installDom();
    document.documentElement.removeAttribute('data-theme');
    document.cookie = 'rfpi-theme=; Max-Age=0; Path=/';
    localStorage.clear();
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
  });
  afterEach(cleanup);

  it('states the current theme and what it will switch to', () => {
    render(<ThemeSwitcher initialPreference="light" />);
    expect(screen.getByRole('button', { name: /Theme: light\. Switch to dark theme/ })).toBeInTheDocument();
  });

  it('is keyboard operable and persists to the DOM, cookie, storage and profile', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher initialPreference="light" />);
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.cookie).toContain('rfpi-theme=dark');
    expect(localStorage.getItem('rfpi-theme')).toBe('dark');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/me/theme', expect.objectContaining({ method: 'POST', body: JSON.stringify({ preference: 'dark' }) }));
    expect(screen.getByRole('button', { name: /Theme: dark\. Switch to light theme/ })).toBeInTheDocument();
  });

  it('does not touch the profile when told not to', async () => {
    render(<ThemeSwitcher initialPreference="dark" persistToProfile={false} />);
    await userEvent.click(screen.getByRole('button'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('offers all three preferences on the settings control and removes data-theme for system', async () => {
    render(<ThemePreferenceControl initialPreference="dark" />);
    expect(screen.getByRole('radio', { name: /Dark/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /System/ }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(await screen.findByText(/Saved: System/)).toBeInTheDocument();
  });
});
