'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Icon } from '../components/Icon';
import { cn } from '../cn';

export interface ProjectOption {
  id: string;
  name: string;
  status: string;
  currentStep: string;
  isDemo: boolean;
}

const STEP_HREF: Record<string, string> = { DATA: 'data', BRIEF: 'brief', PERSONAS: 'personas', SIMULATION: 'simulate', RESULTS: 'results' };

/** The current project, derived from the URL, and a switcher over the projects you are a member of. */
export function ProjectSelector({ projects }: { projects: ProjectOption[] }) {
  const pathname = usePathname();
  const match = /^\/projects\/([^/]+)/.exec(pathname);
  const current = match ? projects.find((p) => p.id === match[1]) : undefined;
  const sub = match ? pathname.split('/')[3] : undefined;

  return (
    <Menu.Root>
      <Menu.Trigger
        className="inline-flex h-8 w-full min-w-0 max-w-[16rem] items-center gap-2 rounded border border-line px-2 text-sm text-ink hover:border-line-strong"
        aria-label={current ? `Current project: ${current.name}. Switch project` : 'Choose a project'}
      >
        <Icon name="folder" size={14} className="shrink-0 text-ink-subtle" />
        <span className="truncate">{current?.name ?? 'Choose a project'}</span>
        {current && (
          <span className={cn('hidden shrink-0 rounded-sm border px-1 font-mono text-[9.5px] uppercase sm:inline', current.status === 'ACTIVE' ? 'border-ok/40 text-ok' : 'border-line text-ink-subtle')}>
            {current.status.toLowerCase()}
          </span>
        )}
        <Icon name="chevronDown" size={13} className="shrink-0" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className="z-50 max-h-[60vh] min-w-[18rem] overflow-y-auto rounded border border-line bg-surface-raised p-1 shadow-pop">
          {projects.length === 0 && <p className="px-2 py-1.5 text-sm text-ink-subtle">You are not a member of any project yet.</p>}
          {projects.map((p) => (
            <Menu.Item key={p.id} asChild className="flex cursor-pointer flex-col rounded px-2 py-1.5 outline-none data-[highlighted]:bg-bg">
              <Link href={`/projects/${p.id}/${sub && Object.values(STEP_HREF).includes(sub) ? sub : STEP_HREF[p.currentStep] ?? 'data'}` as Route} aria-current={p.id === current?.id ? 'true' : undefined}>
                <span className="flex items-center gap-2 text-sm text-ink">
                  {p.id === current?.id && <Icon name="check" size={13} className="text-brand" />}
                  <span className="truncate">{p.name}</span>
                  {p.isDemo && <span className="rounded-sm border border-warn/40 px-1 font-mono text-[9.5px] uppercase text-warn">demo</span>}
                </span>
                <span className="font-mono text-[10.5px] text-ink-subtle">{p.status.toLowerCase()} · step {p.currentStep.toLowerCase()}</span>
              </Link>
            </Menu.Item>
          ))}
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item asChild className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink-muted outline-none data-[highlighted]:bg-bg">
            <Link href="/projects">All projects</Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
