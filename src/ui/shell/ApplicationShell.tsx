'use client';
/**
 * The application shell: top bar, collapsible side navigation, and the workspace.
 *
 * The collapsed state is a per-user convenience kept in a cookie (so the server renders the right
 * width and nothing jumps on load) and localStorage. Below `md` the navigation becomes a drawer.
 */
import { useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CollapsibleSideNavigation } from './CollapsibleSideNavigation';
import { TopNavigation, type TopNavigationProps } from './TopNavigation';
import { Icon } from '../components/Icon';
import { NAV_COOKIE } from '../theme/theme';
import { cn } from '../cn';

export function ApplicationShell({
  children,
  initialCollapsed,
  top,
}: {
  children: ReactNode;
  initialCollapsed: boolean;
  top: Omit<TopNavigationProps, 'onOpenMenu'>;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawer, setDrawer] = useState(false);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${NAV_COOKIE}=${next ? 'collapsed' : 'expanded'}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try {
      localStorage.setItem(NAV_COOKIE, next ? 'collapsed' : 'expanded');
    } catch {
      // cookie is enough
    }
  };

  return (
    <div className="min-h-dvh bg-bg">
      <TopNavigation {...top} onOpenMenu={() => setDrawer(true)} />
      <div className="flex">
        <aside
          className={cn(
            'no-print sticky top-[52px] hidden h-[calc(100dvh-52px)] shrink-0 flex-col justify-between border-r border-line bg-elevated p-2 transition-[width] duration-standard ease-standard md:flex',
            collapsed ? 'w-[3.75rem]' : 'w-56',
          )}
          data-nav-state={collapsed ? 'collapsed' : 'expanded'}
        >
          <CollapsibleSideNavigation isAdmin={top.isAdmin} collapsed={collapsed} />
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className={cn('flex items-center gap-2 rounded px-2.5 py-2 text-xs text-ink-subtle hover:bg-bg hover:text-ink', collapsed && 'justify-center px-0')}
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={15} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </aside>

        <Dialog.Root open={drawer} onOpenChange={setDrawer}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay md:hidden" />
            <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-3 border-r border-line bg-elevated p-3 shadow-pop md:hidden">
              <div className="flex items-center justify-between">
                <Dialog.Title className="font-display text-base text-ink">Navigation</Dialog.Title>
                <Dialog.Close className="rounded p-1.5 text-ink-muted hover:text-ink" aria-label="Close navigation">
                  <Icon name="cross" size={16} />
                </Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">Sections of the application</Dialog.Description>
              <CollapsibleSideNavigation isAdmin={top.isAdmin} collapsed={false} onNavigate={() => setDrawer(false)} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <main id="main" className="bg-grid min-h-[calc(100dvh-52px)] min-w-0 flex-1">
          <div className="mx-auto max-w-wide px-4 py-5 lg:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
