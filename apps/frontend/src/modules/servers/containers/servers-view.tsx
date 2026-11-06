'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { getApiErrorMessage } from '@/api';
import { nodesApi } from '@/api/nodes';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { ServersTable } from '../components/servers-table';
import { removalBlockedReason, toServer, type Server } from '../server';
import { AddServerDialog } from './add-server-dialog';
import { ServerActions } from './server-actions';

/** The Servers page: summary, add wizard and the server list. */
export const ServersView = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-4">
        <div>
          <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
            Servers
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

      {isLoading ? (
        <p role="status" className="px-6 text-sm text-muted-foreground">
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

      <AddServerDialog
        open={isAdding}
        onOpenChange={setIsAdding}
        onChanged={reload}
      />
    </div>
  );
};
