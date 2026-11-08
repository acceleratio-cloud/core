'use client';

import type { MouseEvent } from 'react';
import Link from 'next/link';
import { ScrollText } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useProjectTabs } from '@/modules/projects/providers/project-tabs-provider';
import { buttonVariants } from '@/shared/components/ui/button';
import { projectLogsHref } from '../utils/links';

type ViewLogsLinkProps = {
  projectId: string;
  service?: string;
  pod?: string;
  /** `button`: labelled outline button; `icon`: compact icon for rows. */
  variant?: 'button' | 'icon';
  /** Accessible name for the icon variant. */
  label?: string;
  className?: string;
};

/**
 * Opens the project's Logs tab filtered to a service or one pod. A real link,
 * so it also opens in a new browser tab.
 */
export const ViewLogsLink = ({
  projectId,
  service,
  pod,
  variant = 'button',
  label = 'View logs',
  className,
}: ViewLogsLinkProps) => {
  const { openLogs } = useProjectTabs();
  const href = projectLogsHref(projectId, { service, pod });
  // A plain click switches tabs in place; modified clicks (new tab, new
  // window) keep the link's own behavior.
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    openLogs({ service, pod });
  };

  if (variant === 'icon') {
    return (
      <Link
        href={href}
        scroll={false}
        onClick={handleClick}
        aria-label={label}
        title={label}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
          'text-fg-secondary hover:text-fg-primary',
          className,
        )}
      >
        <ScrollText aria-hidden="true" strokeWidth={1.75} />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      scroll={false}
      onClick={handleClick}
      className={cn(
        buttonVariants({ variant: 'ghost' }),
        'text-fg-secondary hover:text-fg-primary',
        className,
      )}
    >
      <ScrollText
        data-icon="inline-start"
        aria-hidden="true"
        strokeWidth={1.75}
      />
      Logs
    </Link>
  );
};
