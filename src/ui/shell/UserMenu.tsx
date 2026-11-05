'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Icon } from '../components/Icon';

export function UserMenu({ email, role, isAdmin }: { email: string; role: string; isAdmin: boolean }) {
  const router = useRouter();
  const item = 'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink outline-none data-[highlighted]:bg-bg';
  return (
    <Menu.Root>
      <Menu.Trigger
        className="inline-flex h-8 items-center gap-1.5 rounded border border-line px-2 text-ink-muted hover:border-line-strong hover:text-ink"
        aria-label={`Account menu for ${email}`}
      >
        <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-soft font-mono text-[10px] uppercase text-brand">
          {email.slice(0, 1)}
        </span>
        <Icon name="chevronDown" size={13} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={6} className="z-50 min-w-[14rem] rounded border border-line bg-surface-raised p-1 shadow-pop">
          <div className="px-2 py-1.5">
            <p className="truncate font-mono text-[11.5px] text-ink">{email}</p>
            <p className="text-[11px] text-ink-subtle">{role.toLowerCase().replace(/_/g, ' ')}</p>
          </div>
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item asChild className={item}>
            <Link href="/settings"><Icon name="gear" size={14} /> Settings</Link>
          </Menu.Item>
          <Menu.Item asChild className={item}>
            <Link href="/methodology"><Icon name="help" size={14} /> Methodology</Link>
          </Menu.Item>
          {isAdmin && (
            <Menu.Item asChild className={item}>
              <Link href="/admin"><Icon name="shield" size={14} /> Admin</Link>
            </Menu.Item>
          )}
          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item
            className={item}
            onSelect={async () => {
              await fetch('/api/auth/sign-out', { method: 'POST' });
              router.replace('/sign-in');
              router.refresh();
            }}
          >
            <Icon name="external" size={14} /> Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
