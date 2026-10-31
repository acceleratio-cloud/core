'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { Separator } from '@/shared/components/ui/separator';
import { useProject } from '../providers/project-provider';

type ProjectTab = {
  label: string;
  segment: string;
  exact?: boolean;
};

const tabs: ProjectTab[] = [
  { label: 'Overview', segment: '', exact: true },
  { label: 'Observability', segment: '/observability' },
  { label: 'Settings', segment: '/settings' },
];

export const ProjectHeader = () => {
  const { project } = useProject();
  const pathname = usePathname();
  const basePath = `/project/${project.id}`;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          title={project.name}
          className="truncate text-[13px] leading-none font-medium tracking-tight text-foreground"
        >
          {project.name}
        </span>

        <span className="hidden shrink-0 font-mono text-[11px] leading-none text-muted-foreground sm:inline">
          {project.id.slice(0, 8)}
        </span>
      </div>

      <Separator
        orientation="vertical"
        className="mx-0.5 h-4 self-center! bg-border"
      />

      <nav
        aria-label="Project sections"
        className="flex h-full shrink-0 items-stretch gap-1"
      >
        {tabs.map((tab) => {
          const href = `${basePath}${tab.segment}`;
          const active = tab.exact
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={tab.label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex items-center px-2.5 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                active
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-colors',
                  active ? 'bg-foreground' : 'bg-transparent',
                )}
              />
            </Link>
          );
        })}
      </nav>
    </header>
  );
};
