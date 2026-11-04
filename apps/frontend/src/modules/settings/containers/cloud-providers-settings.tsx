'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { SettingsSection } from '../components/settings-section';

type CloudProvider = {
  id: string;
  name: string;
  short: string;
  meta: string;
};

const CLOUD_PROVIDERS: CloudProvider[] = [
  {
    id: 'aws',
    name: 'Amazon Web Services',
    short: 'AWS',
    meta: 'EC2 instances',
  },
  {
    id: 'gcp',
    name: 'Google Cloud',
    short: 'GCP',
    meta: 'Compute Engine',
  },
  {
    id: 'azure',
    name: 'Microsoft Azure',
    short: 'AZ',
    meta: 'Virtual machines',
  },
];

export const CloudProvidersSettings = () => {
  const [connectedIds, setConnectedIds] = useState<string[]>([]);

  const toggleConnection = (id: string) => {
    setConnectedIds((currentIds) =>
      currentIds.includes(id)
        ? currentIds.filter((currentId) => currentId !== id)
        : [...currentIds, id],
    );
  };

  return (
    <SettingsSection
      id="cloud-providers"
      title="Cloud providers"
      description="Accounts the console can provision servers into."
    >
      <ul className="divide-y divide-border">
        {CLOUD_PROVIDERS.map((provider) => {
          const connected = connectedIds.includes(provider.id);

          return (
            <li
              key={provider.id}
              className="flex flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60 font-mono text-[10px] text-muted-foreground">
                {provider.short}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {provider.name}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {provider.meta}
                </p>
              </div>

              <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    connected
                      ? 'bg-foreground'
                      : 'border border-muted-foreground',
                  )}
                />
                {connected ? 'Connected' : 'Not connected'}
              </span>

              <Button
                type="button"
                size="sm"
                variant={connected ? 'ghost' : 'outline'}
                onClick={() => toggleConnection(provider.id)}
                aria-label={`${connected ? 'Disconnect' : 'Connect'} ${provider.name}`}
              >
                {connected ? 'Disconnect' : 'Connect'}
              </Button>
            </li>
          );
        })}
      </ul>
    </SettingsSection>
  );
};
