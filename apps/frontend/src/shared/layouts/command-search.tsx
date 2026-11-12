'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Boxes, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Project } from '@acceleratio/shared';

import { getApiErrorMessage } from '@/api';
import { projectsApi } from '@/api/projects';
import {
  SETTINGS_SECTIONS,
  settingsSectionHref,
} from '@/modules/settings/sections';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/shared/components/ui/command';
import { Kbd } from '@/shared/components/ui/kbd';

export type CommandPage = { label: string; href: string; icon: LucideIcon };

const subscribeToPlatform = () => () => {};

const useIsApplePlatform = () =>
  useSyncExternalStore(
    subscribeToPlatform,
    () => /mac|iphone|ipad/i.test(navigator.userAgent),
    () => true,
  );

/** ⌘K palette in the header: jumps to any console page or project. */
export const CommandSearch = ({ pages }: { pages: CommandPage[] }) => {
  const router = useRouter();
  const isApple = useIsApplePlatform();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refetch on every open so new or renamed projects show up.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      return;
    }

    setError(null);
    projectsApi
      .list()
      .then(setProjects)
      .catch((requestError) => setError(getApiErrorMessage(requestError)));
  };

  const openRef = useRef(handleOpenChange);
  useEffect(() => {
    openRef.current = handleOpenChange;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Autofill and datalist picks dispatch keydown events without a key.
      if (
        typeof event.key !== 'string' ||
        event.key.toLowerCase() !== 'k' ||
        !(event.metaKey || event.ctrlKey)
      ) {
        return;
      }

      event.preventDefault();
      openRef.current(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const shortcut = isApple ? '⌘K' : 'Ctrl K';

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        aria-label="Quick search"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex size-8 items-center justify-center gap-2 rounded-full border border-border bg-background text-[13px] text-muted-foreground outline-none transition-[border-color,box-shadow,color] hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 lg:w-64 lg:justify-start lg:px-3"
      >
        <Search
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 shrink-0"
        />
        <span className="hidden flex-1 text-left lg:inline">
          Quick search...
        </span>
        <Kbd className="hidden lg:inline-flex">{shortcut}</Kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Quick search"
        description="Search pages and projects"
      >
        <Command>
          <CommandInput placeholder="Search pages and projects..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            <CommandGroup heading="Pages">
              {pages.map(({ label, href, icon: Icon }) => (
                <CommandItem
                  key={href}
                  value={href}
                  keywords={[label]}
                  onSelect={() => go(href)}
                >
                  <Icon
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="text-muted-foreground"
                  />
                  {label}
                </CommandItem>
              ))}
              {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => (
                <CommandItem
                  key={id}
                  value={settingsSectionHref(id)}
                  keywords={['Settings', label]}
                  onSelect={() => go(settingsSectionHref(id))}
                >
                  <Icon
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="text-muted-foreground"
                  />
                  <span className="text-muted-foreground">Settings /</span>
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Projects">
              {error ? (
                <p
                  role="alert"
                  className="px-2 py-1.5 text-[13px] text-destructive"
                >
                  {error}
                </p>
              ) : projects === null ? (
                <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
                  Loading projects...
                </p>
              ) : (
                projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={`/project/${project.id}`}
                    keywords={[project.name]}
                    onSelect={() => go(`/project/${project.id}`)}
                  >
                    <Boxes
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="text-muted-foreground"
                    />
                    <span className="truncate">{project.name}</span>
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
};
