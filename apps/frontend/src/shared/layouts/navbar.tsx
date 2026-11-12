'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, Server, Settings, Store } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Separator } from '@/shared/components/ui/separator';
import { LogoIcon } from '../icons/logo-icon';
import { SystemStatusButton } from '@/modules/system/containers/system-status';
import { CommandSearch, type CommandPage } from './command-search';
import { UserMenu } from './user-menu';

const links: CommandPage[] = [
  { label: 'Overview', href: '/', icon: House },
  { label: 'Marketplace', href: '/marketplace', icon: Store },
  { label: 'Servers', href: '/servers', icon: Server },
  { label: 'Settings', href: '/settings', icon: Settings },
];

const isActivePath = (pathname: string, href: string) =>
  href === '/'
    ? pathname === '/'
    : pathname === href || pathname.startsWith(`${href}/`);

export const Navbar = () => {
  const pathname = usePathname();

  return (
    <div className="flex h-full items-center gap-3 px-4 sm:px-5">
      <Link
        href="/"
        aria-label="Acceleratio home"
        className="flex shrink-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground/60"
      >
        <LogoIcon className="size-5 fill-foreground" />
        <span className="hidden text-[13px] font-medium tracking-wide text-foreground sm:inline">
          cceleratio
          <span className="text-[11px] text-muted-foreground">.cloud</span>
        </span>
      </Link>

      <Separator orientation="vertical" className="mx-0.5 h-4 self-center!" />

      <nav
        aria-label="Primary"
        className="flex min-w-0 items-center gap-0.5 rounded-full border border-border bg-surface-panel/70 p-0.5"
      >
        {links.map((link) => (
          <NavItem
            key={link.href}
            link={link}
            active={isActivePath(pathname, link.href)}
          />
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <SystemStatusButton />
        <CommandSearch pages={links} />

        <UserMenu />
      </div>
    </div>
  );
};

const NavItem = ({ link, active }: { link: CommandPage; active: boolean }) => {
  const Icon = link.icon;

  return (
    <Link
      href={link.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-7 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] outline-0 transition-[background-color,border-color,color,scale] duration-100 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none',
        active
          ? 'bg-surface-muted font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground active:scale-[0.98] motion-reduce:active:scale-100',
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn(
          'size-3.5 shrink-0',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      />
      <span className="sr-only sm:not-sr-only sm:truncate">{link.label}</span>
    </Link>
  );
};
