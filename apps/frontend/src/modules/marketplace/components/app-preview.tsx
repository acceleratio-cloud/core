import { Globe, HardDrive } from 'lucide-react';

import type { MarketplaceApp, MarketplaceService } from '@acceleratio/shared';

import { AppIcon } from './app-icon';

const ServiceNode = ({ service }: { service: MarketplaceService }) => (
  <div className="w-56 rounded-lg border border-border bg-surface-raised p-3 shadow-key-soft">
    <div className="flex items-center gap-2.5">
      <AppIcon src={service.icon} className="size-8 rounded-md" />
      <div className="min-w-0">
        <p className="text-sm leading-none font-medium text-foreground">
          {service.name}
        </p>
        <p className="mt-1 truncate font-mono text-[11px] text-fg-secondary">
          {service.image}
        </p>
      </div>
    </div>
    {service.volume ? (
      <p className="mt-2.5 flex items-center gap-1.5 border-t border-border pt-2 text-xs text-muted-foreground">
        <HardDrive aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
        <span className="truncate font-mono">{service.volume.path}</span>
        <span className="ml-auto shrink-0 tabular-nums">
          {service.volume.size_gib} GiB
        </span>
      </p>
    ) : null}
  </div>
);

const Wire = ({ label }: { label?: string }) => (
  <div className="relative flex h-6 w-px items-center justify-center bg-edge-control xl:h-px xl:w-16">
    {label ? (
      <span className="absolute left-2 rounded-sm bg-surface-board px-1 font-mono text-[10px] text-fg-tertiary xl:-top-4 xl:left-1/2 xl:-translate-x-1/2">
        {label}
      </span>
    ) : null}
  </div>
);

/**
 * What the template creates, drawn the way the project canvas draws it: the
 * public domain, the app and the services it reaches over the private network.
 */
export const AppPreview = ({ app }: { app: MarketplaceApp }) => {
  const [main, ...deps] = app.services;

  return (
    <div
      role="img"
      aria-label={`${app.name} deploys ${app.services.map((s) => s.name).join(', ')}`}
      className="flex min-h-72 flex-col items-center justify-center overflow-x-auto rounded-lg border border-border bg-surface-board px-6 py-10 xl:flex-row"
      style={{
        backgroundImage:
          'radial-gradient(var(--board-grid) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
      }}
    >
      {main.public ? (
        <>
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs text-muted-foreground">
            <Globe aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
            https://your-domain
          </div>
          <Wire label="443" />
        </>
      ) : null}
      <ServiceNode service={main} />
      {deps.length > 0 ? (
        <>
          <Wire />
          <div className="flex flex-col gap-3 border-edge-control xl:border-l xl:pl-6">
            {deps.map((service) => (
              <div key={service.name} className="flex items-center gap-3">
                <span className="hidden font-mono text-[10px] text-fg-tertiary xl:inline">
                  :{service.port}
                </span>
                <ServiceNode service={service} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
};
