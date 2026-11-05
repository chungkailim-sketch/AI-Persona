'use client';
/**
 * The application shell: a sticky top bar (logo, the five steps, More, theme, language, account) and
 * a centred 1200 px column. Below `md` the navigation becomes a drawer.
 */
import { useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CollapsibleSideNavigation } from './CollapsibleSideNavigation';
import { StepNav } from './StepNav';
import { TopNavigation, type TopNavigationProps } from './TopNavigation';
import { Icon } from '../components/Icon';

export function ApplicationShell({ children, top }: { children: ReactNode; top: Omit<TopNavigationProps, 'onOpenMenu'> }) {
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="min-h-dvh bg-bg">
      <TopNavigation {...top} onOpenMenu={() => setDrawer(true)} />

      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay md:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-80 max-w-[88vw] flex-col gap-4 overflow-y-auto bg-bg p-5 shadow-pop md:hidden">
            <div className="flex items-center justify-between">
              <Dialog.Title className="eyebrow">Navigation</Dialog.Title>
              <Dialog.Close className="rounded p-1.5 text-ink-muted hover:text-ink" aria-label="Close navigation">
                <Icon name="cross" size={16} />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Sections of the application</Dialog.Description>
            <StepNav vertical onNavigate={() => setDrawer(false)} />
            <CollapsibleSideNavigation isAdmin={top.isAdmin} collapsed={false} onNavigate={() => setDrawer(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <main id="main" className="min-h-[calc(100dvh-68px)] min-w-0 bg-bg">
        <div className="mx-auto max-w-[1200px] px-5 py-10 lg:px-8 lg:py-14">{children}</div>
      </main>
      <footer className="no-print border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2 px-5 py-6 text-xs text-ink-subtle lg:px-8">
          <span>© Ruder Finn. Personas are illustrative and built from published survey statistics.</span>
          <span>Decision support, not evidence of real behaviour.</span>
        </div>
      </footer>
    </div>
  );
}
