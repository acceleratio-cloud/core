'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Boxes, Check, Plus } from 'lucide-react';

import type { Project } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { projectsApi } from '@/api/projects';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useProject } from '../providers/project-provider';
import {
  DEFAULT_PROJECT_TAB,
  PROJECT_TAB_PARAM,
  type ProjectTabId,
} from '../tabs';
import {
  CreateProjectDialog,
  type ProjectDraft,
} from './create-project-dialog';

const SKELETON_ROWS = 2;

/**
 * The project name in the header, as the trigger of a menu that switches to
 * another project or creates one. The list loads when the menu opens, so the
 * header costs nothing until it is used.
 */
export const ProjectSwitcher = ({
  activeTab = DEFAULT_PROJECT_TAB,
}: {
  /** Kept when switching, so Observability stays Observability. */
  activeTab?: ProjectTabId;
}) => {
  const router = useRouter();
  const projectHref = (id: string) =>
    activeTab === DEFAULT_PROJECT_TAB
      ? `/project/${id}`
      : `/project/${id}?${PROJECT_TAB_PARAM}=${activeTab}`;
  const { project } = useProject();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const loadProjects = async () => {
    setError(null);

    try {
      setProjects(await projectsApi.list());
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    }
  };

  const handleMenuOpenChange = (open: boolean) => {
    if (open) {
      void loadProjects();
    }
  };

  const handleCreate = async ({ name }: ProjectDraft) => {
    const created = await projectsApi.create({ name });

    setProjects((current) => [created, ...(current ?? [])]);
    router.push(`/project/${created.id}`);
  };

  // Until the list arrives, the current project is the only row, so the menu
  // never opens empty.
  const items = projects ?? [project];
  const isLoading = projects === null && error === null;

  return (
    <>
      <DropdownMenu onOpenChange={handleMenuOpenChange}>
        <DropdownMenuTrigger
          aria-label={`Switch project, current: ${project.name}`}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            // The menu trigger resets outline-style, so focus restores it. No
            // offset: the header pill is only 4px taller than this button.
            'h-7.5 min-w-0 flex items-center gap-2 max-w-40 rounded-lg px-2.5 text-[13px] font-medium tracking-tight focus-visible:outline-solid focus-visible:outline-offset-0 sm:max-w-56',
          )}
        >
          <span title={project.name} className="truncate">
            {project.name}
          </span>
          <span className="hidden shrink-0 font-mono text-[11px] leading-none text-muted-foreground sm:inline">
            {project.id.slice(0, 8)}
          </span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Projects</DropdownMenuLabel>

            <div className="max-h-64 overflow-y-auto" aria-busy={isLoading}>
              {items.map((item) => {
                const isCurrent = item.id === project.id;

                return (
                  <DropdownMenuLinkItem
                    key={item.id}
                    closeOnClick
                    label={item.name}
                    aria-current={isCurrent ? 'page' : undefined}
                    render={<Link href={projectHref(item.id)} />}
                    className={cn(isCurrent && 'font-medium')}
                  >
                    <Boxes
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span title={item.name} className="min-w-0 flex-1 truncate">
                      {item.name}
                    </span>
                    {isCurrent ? (
                      <Check
                        aria-hidden="true"
                        strokeWidth={2}
                        className="size-3.5 shrink-0 text-foreground"
                      />
                    ) : null}
                  </DropdownMenuLinkItem>
                );
              })}

              {isLoading
                ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                    <div
                      key={index}
                      aria-hidden="true"
                      className="flex h-8 items-center gap-2.5 px-2"
                    >
                      <Skeleton className="size-3.5 shrink-0" />
                      <Skeleton className="h-3 flex-1" />
                    </div>
                  ))
                : null}
            </div>

            {error ? (
              <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => setIsCreateOpen(true)}>
            <Plus
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            Create project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Outside the menu: the popup unmounts as soon as an item is chosen. */}
      <CreateProjectDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreate={handleCreate}
        existingNames={[
          project.name,
          ...(projects ?? []).map((item) => item.name),
        ]}
      />
    </>
  );
};
