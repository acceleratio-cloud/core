'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';
import { Separator } from '@/shared/components/ui/separator';
import { ProjectSwitcher } from '../containers/project-switcher';
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
    <header className="flex h-10 min-w-0 items-center gap-2.5 rounded-lg border border-border bg-surface-raised p-1 pl-1.5 shadow-float">
      <div className="flex min-w-0 items-center gap-1.5">
        <ProjectSwitcher />

        <span className="hidden shrink-0 font-mono text-[11px] leading-none text-muted-foreground sm:inline">
          {project.id.slice(0, 8)}
        </span>
      </div>

      <Separator
        orientation="vertical"
        className="h-4 shrink-0 self-center!"
      />

      <nav
        aria-label="Project sections"
        className="flex shrink-0 items-center gap-0.5"
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
                'flex h-7.5 items-center rounded-lg px-3 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-foreground/60',
                active
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
};
