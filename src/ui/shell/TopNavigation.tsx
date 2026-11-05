'use client';
import Link from 'next/link';
import type { ActivitySummary } from '@/server/activity';
import { Icon } from '../components/Icon';
import { BrandLogo } from './BrandLogo';
import { GlobalRunIndicator } from './GlobalRunIndicator';
import { ProjectSelector, type ProjectOption } from './ProjectSelector';
import { ThemeSwitcher } from './ThemeSwitcher';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import { UserMenu } from './UserMenu';
import { MoreMenu } from './MoreMenu';
import { StepNav } from './StepNav';
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
    <header className="no-print sticky top-0 z-30 border-b border-line bg-elevated/85 backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-[1200px] items-center gap-4 px-5 lg:gap-7 lg:px-8">
        <button type="button" onClick={onOpenMenu} className="rounded p-1.5 text-ink-muted hover:text-ink md:hidden" aria-label="Open navigation">
          <Icon name="menu" size={18} />
        </button>
        <Link href="/dashboard" className="flex shrink-0 items-center text-ink" aria-label="rf.AI Persona — home">
          <BrandLogo height={22} />
        </Link>
        <div className="hidden min-w-0 xl:block xl:max-w-[14rem]">
          <ProjectSelector projects={projects} />
        </div>
        <div className="hidden md:block md:flex-1">
          <div className="flex justify-center"><StepNav /></div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2.5 md:ml-0 lg:gap-3.5">
          {environment !== 'production' && (
            <span className="hidden rounded-sm border border-info/40 bg-info-soft px-1.5 py-0.5 text-[10px] uppercase text-info 2xl:inline" title="This is not the production environment.">
              {environment}
            </span>
          )}
          {mockProvider && (
            <span className="rounded-sm border border-warn/40 bg-warn-soft px-1.5 py-0.5 text-[10px] uppercase text-warn" title="The mock model provider is configured. No AI model is consulted; outputs mean nothing.">
              <span className="hidden sm:inline">Demonstration data</span>
              <span className="sm:hidden">Mock</span>
            </span>
          )}
          <GlobalRunIndicator initial={activity} />
          <span className="hidden md:inline-flex"><MoreMenu isAdmin={isAdmin} /></span>
          <LanguageSwitcher />
          <ThemeSwitcher initialPreference={themePreference} />
          <Link href="/projects" className="hidden rounded-full bg-action px-5 py-2.5 text-[12.5px] font-medium tracking-wide text-action-ink transition-transform duration-fast hover:-translate-y-px lg:inline-block">
            Start a new study
          </Link>
          <UserMenu email={userEmail} role={userRole} isAdmin={isAdmin} />
        </div>
      </div>
    </header>
  );
}
