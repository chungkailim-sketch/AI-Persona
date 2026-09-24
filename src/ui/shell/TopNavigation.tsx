'use client';
import Link from 'next/link';
import type { ActivitySummary } from '@/server/activity';
import { Icon } from '../components/Icon';
import { GlobalRunIndicator } from './GlobalRunIndicator';
import { ProjectSelector, type ProjectOption } from './ProjectSelector';
import { ThemeSwitcher } from './ThemeSwitcher';
import { UserMenu } from './UserMenu';
import type { ThemePreference } from '../theme/theme';

export interface TopNavigationProps {
  userEmail: string;
  userRole: string;
  isAdmin: boolean;
  projects: ProjectOption[];
  /** "development", "test" … — anything but production is shown. */
  environment: string;
  mockProvider: boolean;
  activity: ActivitySummary;
  themePreference: ThemePreference;
  onOpenMenu: () => void;
}

export function TopNavigation({ userEmail, userRole, isAdmin, projects, environment, mockProvider, activity, themePreference, onOpenMenu }: TopNavigationProps) {
  return (
    <header className="no-print sticky top-0 z-30 h-[52px] border-b border-line bg-elevated/95 backdrop-blur">
      <div className="flex h-full items-center gap-2 px-3 lg:gap-3 lg:px-4">
        <button type="button" onClick={onOpenMenu} className="rounded p-1.5 text-ink-muted hover:text-ink md:hidden" aria-label="Open navigation">
          <Icon name="menu" size={18} />
        </button>
        {/* Logo slot — replace with the approved asset. Brand owner validation required. */}
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2 font-display text-[15px] font-semibold text-ink">
          <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-brand">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-brand-ink" />
          </span>
          <span className="hidden sm:inline">Persona Intelligence</span>
        </Link>
        <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
        <div className="min-w-0 flex-1 sm:flex-none">
          <ProjectSelector projects={projects} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {environment !== 'production' && (
            <span className="hidden rounded-sm border border-info/40 bg-info-soft px-1.5 py-0.5 font-mono text-[10px] uppercase text-info md:inline" title="This is not the production environment.">
              {environment}
            </span>
          )}
          {mockProvider && (
            <span className="rounded-sm border border-warn/40 bg-warn-soft px-1.5 py-0.5 font-mono text-[10px] uppercase text-warn" title="The mock model provider is configured. No AI model is consulted; outputs mean nothing.">
              <span className="hidden sm:inline">Demonstration data</span>
              <span className="sm:hidden">Mock</span>
            </span>
          )}
          <GlobalRunIndicator initial={activity} />
          <Link href="/methodology" className="hidden h-8 w-8 items-center justify-center rounded border border-line text-ink-muted hover:border-line-strong hover:text-ink sm:inline-flex" aria-label="Methodology and help" title="Methodology and help">
            <Icon name="help" size={16} />
          </Link>
          <ThemeSwitcher initialPreference={themePreference} />
          {isAdmin && (
            <Link href="/admin" className="hidden h-8 items-center rounded border border-line px-2 text-xs text-ink-muted hover:border-line-strong hover:text-ink lg:inline-flex">
              Admin
            </Link>
          )}
          <UserMenu email={userEmail} role={userRole} isAdmin={isAdmin} />
        </div>
      </div>
    </header>
  );
}
