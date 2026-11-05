'use client';
/**
 * The five steps as links in the top bar, when a project is open (the current one underlined in RF
 * green); outside a project, Home and Projects. The page itself still carries each step's status.
 */
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { WORKFLOW_STEPS } from './steps';
import { isActive } from './nav';
import { cn } from '../cn';

const STEP_OF_SEGMENT: Record<string, string> = { data: 'data', brief: 'brief', personas: 'personas', simulate: 'simulate', results: 'results', report: 'results' };

export function StepNav({ vertical = false, onNavigate }: { vertical?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const m = /^\/projects\/([^/]+)(?:\/(?:advanced\/)?([^/]+))?/.exec(pathname);
  const projectId = m && m[1] !== 'new' ? m[1] : null;
  const current = projectId ? STEP_OF_SEGMENT[m?.[2] ?? ''] : null;

  const base = vertical ? 'flex items-center gap-3 border-t border-line py-3 text-[15px]' : 'flex items-center gap-2 border-b-2 py-1.5 text-sm';
  const on = vertical ? 'text-ink' : 'border-brand-mark text-ink';
  const off = vertical ? 'text-ink-muted hover:text-ink' : 'border-transparent text-ink-muted hover:text-ink';

  const items = projectId
    ? WORKFLOW_STEPS.map((s) => ({ key: s.key, href: `/projects/${projectId}/${s.href}`, label: s.label, index: s.index, active: current === s.href }))
    : [
        { key: 'home', href: '/dashboard', label: 'Home', index: 0, active: isActive(pathname, '/dashboard') },
        { key: 'projects', href: '/projects', label: 'Projects', index: 0, active: isActive(pathname, '/projects') },
      ];

  return (
    <nav aria-label={projectId ? 'Study steps' : 'Primary'} className={cn(vertical ? 'w-full' : 'hidden md:block')}>
      <ul className={cn(vertical ? 'flex flex-col' : 'flex items-center gap-7')}>
        {items.map((i) => (
          <li key={i.key}>
            <Link href={i.href as Route} prefetch={false} onClick={onNavigate} aria-current={i.active ? 'page' : undefined} className={cn('motion-color font-medium', base, i.active ? on : off)}>
              {i.index > 0 && <span className="text-xs font-normal tabular-nums text-ink-subtle">{`0${i.index}`}</span>}
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
