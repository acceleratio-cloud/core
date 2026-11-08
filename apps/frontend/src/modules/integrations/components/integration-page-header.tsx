import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { buttonVariants } from '@/shared/components/ui/button';
import { cn } from '@/lib/utils';
import { settingsSectionHref } from '@/modules/settings/sections';
import type { Integration } from '../catalog';
import { IntegrationIcon } from './integration-icon';

type IntegrationPageHeaderProps = {
  integration: Integration;
  /** Optional control aligned right, such as the primary action. */
  action?: ReactNode;
};

export const IntegrationPageHeader = ({
  integration,
  action,
}: IntegrationPageHeaderProps) => (
  <header>
    <Link
      href={settingsSectionHref('integrations')}
      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}
    >
      <ArrowLeft
        aria-hidden="true"
        strokeWidth={1.75}
        data-icon="inline-start"
      />
      Integrations
    </Link>

    <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        <IntegrationIcon integration={integration} className="size-12" />
        <div className="min-w-0">
          <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
            {integration.name}
          </h1>
          <p className="mt-2.5 text-sm text-muted-foreground">
            {integration.description}
          </p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  </header>
);
