'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ADMIN_SECTION, NAV_SECTIONS, isActive } from './nav';
import { Icon } from '../components/Icon';
import { cn } from '../cn';

/**
 * Side navigation. Expanded shows icon + label; collapsed shows icons with tooltips, and every link
 * keeps its accessible name either way. Plain links in a list — Tab moves through them, Enter
 * follows; there is no custom key handling to learn.
 */
export function CollapsibleSideNavigation({ isAdmin, collapsed, onNavigate }: { isAdmin: boolean; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const items = [
    ...NAV_SECTIONS.filter((s) => !('requires' in s) || isAdmin),
    ...(isAdmin ? [ADMIN_SECTION] : []),
  ];
  return (
    <Tooltip.Provider delayDuration={200}>
      <nav aria-label="Sections" className="w-full">
        <ul className="flex flex-col gap-0.5">
          {items.map((s) => {
            const active = isActive(pathname, s.href);
            const link = (
              <Link
                href={s.href as Route}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? s.label : undefined}
                className={cn(
                  'motion-color flex items-center gap-2.5 rounded px-2.5 py-2 text-sm',
                  collapsed && 'justify-center px-0',
                  active ? 'bg-brand-soft font-medium text-brand' : 'text-ink-muted hover:bg-bg hover:text-ink',
                )}
              >
                <Icon name={s.icon} size={17} className="shrink-0" />
                {!collapsed && <span className="truncate">{s.label}</span>}
              </Link>
            );
            return (
              <li key={s.href}>
                {collapsed ? (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content side="right" sideOffset={8} className="z-50 rounded border border-line bg-surface-raised px-2 py-1 text-xs text-ink shadow-pop">
                        {s.label}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                ) : (
                  link
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </Tooltip.Provider>
  );
}
