import Link from 'next/link';
import { Boxes, Scale } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { MarketplaceApp } from '@acceleratio/shared';

import { formatServices } from '../format';
import { AppIcon } from './app-icon';

export const AppCard = ({ app }: { app: MarketplaceApp }) => (
  <Link
    href={`/marketplace/${app.slug}`}
    className={cn(
      'group panel-lit flex h-full flex-col rounded-xl p-4 outline-none',
      'transition-[transform,border-color] duration-150 hover:border-edge-strong focus-visible:ring-2 focus-visible:ring-ring/50',
      'motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0',
    )}
  >
    <div className="flex items-start gap-3">
      <AppIcon
        src={app.icon}
        className="size-11 transition-transform duration-150 motion-safe:group-hover:scale-[1.04]"
      />
      <div className="min-w-0">
        <h3 className="text-sm leading-none font-medium text-foreground">
          {app.name}
        </h3>
        <p className="mt-1.5 text-xs text-fg-secondary">{app.category}</p>
      </div>
    </div>
    <p className="mt-3 flex-1 text-[13px] text-muted-foreground">
      {app.tagline}
    </p>
    <div className="mt-4 flex items-center gap-3 border-t border-border pt-3 text-xs text-fg-secondary">
      <span className="inline-flex items-center gap-1">
        <Scale aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
        {app.license}
      </span>
      <span className="inline-flex items-center gap-1">
        <Boxes aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
        {formatServices(app.services.length)}
      </span>
    </div>
  </Link>
);
