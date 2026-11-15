'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';

import { getApiErrorMessage } from '@/api';
import { nodesApi } from '@/api/nodes';
import { cn } from '@/lib/utils';
import { ServersTable } from '@/modules/servers/components/servers-table';
import { AddServerDialog } from '@/modules/servers/containers/add-server-dialog';
import { ServerActions } from '@/modules/servers/containers/server-actions';
import {
  removalBlockedReason,
  toServer,
  type Server,
} from '@/modules/servers/server';
import {
  SystemStatusList,
  useSystemStatus,
} from '@/modules/system/containers/system-status';
import { Button } from '@/shared/components/ui/button';
import { CapacityOverview } from './capacity-overview';
import { StoragePanel } from './storage-panel';

const ClusterSection = ({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) => (
  <section aria-labelledby={id} className="flex flex-col gap-3 px-4">
    <h2 id={id} className="px-1 text-[13px] font-medium text-foreground">
      {title}
      {hint ? (
        <span className="ml-2 font-normal text-muted-foreground">{hint}</span>
      ) : null}
    </h2>
    {children}
  </section>
);

/** The Cluster page: capacity, system status, servers and storage. */
export const ClusterView = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const status = useSystemStatus();

  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((count) => count + 1), []);

  useEffect(() => {
    let active = true;

    nodesApi
      .list()
      .then((nodes) => {
        if (active) {
          setServers(nodes.map(toServer));
          setError(null);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(getApiErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [reloads]);

  const total = servers.length;
  const ready = servers.filter((server) => server.status === 'ready').length;
  const notReady = servers.filter(
    (server) => server.status === 'not-ready',
  ).length;

  return (
    <div className="flex flex-1 flex-col gap-8 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6">
        <div>
          <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
            Cluster
          </h1>
          <p
            aria-live="polite"
            className={cn(
              'mt-2.5 text-sm',
              error ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {isLoading ? (
              'Loading servers...'
            ) : error ? (
              error
            ) : (
              <>
                {total} {total === 1 ? 'server' : 'servers'} · {ready} ready
                {notReady > 0 ? (
                  <>
                    {' · '}
                    <span className="text-destructive">
                      {notReady} not ready
                    </span>
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => setIsAdding(true)}>
            <Plus aria-hidden="true" strokeWidth={1.75} />
            Add server
          </Button>
        </div>
      </div>

      <ClusterSection id="cluster-capacity" title="Capacity">
        <CapacityOverview refreshKey={reloads} />
      </ClusterSection>

      <ClusterSection
        id="cluster-status"
        title="System status"
        hint={status.components ? status.summary.label : undefined}
      >
        <SystemStatusList
          components={status.components}
          error={status.error}
          compact
        />
      </ClusterSection>

      <section
        aria-labelledby="cluster-servers"
        className="flex flex-col gap-3"
      >
        <h2
          id="cluster-servers"
          className="px-5 text-[13px] font-medium text-foreground"
        >
          Servers
        </h2>
        {isLoading ? (
          <p role="status" className="px-5 text-sm text-muted-foreground">
            Loading servers...
          </p>
        ) : (
          <ServersTable
            servers={servers}
            renderActions={(server) => (
              <ServerActions
                server={server}
                removeBlockedReason={removalBlockedReason(server, servers)}
                onChanged={reload}
              />
            )}
          />
        )}
      </section>

      <div className="px-4">
        <StoragePanel />
      </div>

      <AddServerDialog
        open={isAdding}
        onOpenChange={setIsAdding}
        onChanged={reload}
      />
    </div>
  );
};
