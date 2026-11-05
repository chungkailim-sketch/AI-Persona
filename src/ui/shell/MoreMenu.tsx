'use client';
/** Everything that is not a step: the Advanced research tools, methodology, settings and admin. */
import Link from 'next/link';
import type { Route } from 'next';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Icon } from '../components/Icon';
import { ADMIN_SECTION, NAV_SECTIONS } from './nav';

export function MoreMenu({ isAdmin }: { isAdmin: boolean }) {
  const item = 'flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-panel';
  const advanced = NAV_SECTIONS.filter((s) => 'group' in s && s.group === 'advanced' && !('requires' in s && s.requires === 'admin' && !isAdmin));
  const rest = NAV_SECTIONS.filter((s) => !('group' in s));
  return (
    <Menu.Root>
      <Menu.Trigger className="inline-flex items-center gap-1 rounded px-1 py-1.5 text-sm font-medium text-ink-muted hover:text-ink" aria-label="More">
        More <Icon name="chevronDown" size={13} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={10} className="z-50 min-w-[15rem] rounded-lg border border-line bg-surface-raised p-1.5 shadow-pop">
          <p className="eyebrow px-2.5 pb-1 pt-2">Advanced</p>
          {advanced.map((s) => (
            <Menu.Item key={s.href} asChild className={item}>
              <Link href={s.href as Route} prefetch={false}><Icon name={s.icon} size={15} /> {s.label}</Link>
            </Menu.Item>
          ))}
          <Menu.Separator className="my-1.5 h-px bg-line" />
          {rest.map((s) => (
            <Menu.Item key={s.href} asChild className={item}>
              <Link href={s.href as Route} prefetch={false}><Icon name={s.icon} size={15} /> {s.label}</Link>
            </Menu.Item>
          ))}
          {isAdmin && (
            <Menu.Item asChild className={item}>
              <Link href={ADMIN_SECTION.href as Route} prefetch={false}><Icon name={ADMIN_SECTION.icon} size={15} /> {ADMIN_SECTION.label}</Link>
            </Menu.Item>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
