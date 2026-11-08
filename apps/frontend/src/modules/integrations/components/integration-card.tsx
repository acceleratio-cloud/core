import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Integration } from '../catalog';
import { IntegrationIcon } from './integration-icon';

type IntegrationCardProps = {
  integration: Integration;
  /** Live state of a shipped integration, such as "1 App · 29 repositories". */
  status?: string | null;
};

const CARD =
  'flex h-full items-center gap-3.5 rounded-lg border border-border bg-surface-raised px-4 py-3.5';

export const IntegrationCard = ({
  integration,
  status,
}: IntegrationCardProps) => {
  const body = (
    <>
      <IntegrationIcon integration={integration} className="size-9" />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm leading-none font-medium text-foreground">
          {integration.name}
        </h3>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          {integration.description}
        </p>
        <p className="mt-1.5 truncate text-xs text-fg-secondary">
          {integration.href ? (status ?? 'Not connected') : 'Coming soon'}
        </p>
      </div>
    </>
  );

  if (!integration.href) {
    return <div className={CARD}>{body}</div>;
  }

  return (
    <Link
      href={integration.href}
      className={cn(
        CARD,
        'group outline-none transition-[transform,border-color,background-color] duration-150',
        'hover:border-edge-control hover:bg-surface-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50',
        'motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0',
      )}
    >
      {body}
      <ArrowRight
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
      />
    </Link>
  );
};
