import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { Server, ServerStatus } from '../server';

const STATUS_DOT: Record<ServerStatus, string> = {
  ready: 'text-status-success',
  'not-ready': 'text-status-danger',
  unknown: 'text-fg-tertiary',
};

const STATUS_LABEL: Record<ServerStatus, string> = {
  ready: 'Ready',
  'not-ready': 'Not ready',
  unknown: 'Unknown',
};

const Cell = ({ children }: { children: ReactNode }) => (
  <td className="px-4 py-3 align-middle">{children}</td>
);

/** Servers as rows. Actions come in as a slot so the table stays presentational. */
export const ServersTable = ({
  servers,
  renderActions,
}: {
  servers: Server[];
  renderActions: (server: Server) => ReactNode;
}) => (
  <div className="m-4 mt-0 overflow-x-auto rounded-xl border border-border bg-surface-raised">
    <table className="w-full min-w-[44rem] text-left text-sm">
      <caption className="sr-only">Cluster servers</caption>
      <thead className="border-b border-border bg-surface-panel text-xs text-muted-foreground">
        <tr>
          {[
            'Server',
            'Status',
            'Role',
            'Address',
            'Capacity',
            'Pods',
            'Version',
          ].map((heading) => (
            <th key={heading} scope="col" className="px-4 py-2.5 font-medium">
              {heading}
            </th>
          ))}
          <th scope="col" className="w-12 px-4 py-2.5">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {servers.map((server) => (
          <tr
            key={server.id}
            className="transition-colors hover:bg-surface-muted/40"
          >
            <Cell>
              <span
                className="block max-w-56 truncate font-medium"
                title={server.name}
              >
                {server.name}
              </span>
              {server.taints.length > 0 ||
              Object.keys(server.labels).length > 0 ? (
                <span className="block text-xs text-muted-foreground">
                  {server.taints.length} taints
                </span>
              ) : null}
            </Cell>
            <Cell>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn('status-dot', STATUS_DOT[server.status])}
                />
                <span
                  className={cn(
                    server.status === 'not-ready' &&
                      'font-medium text-destructive',
                  )}
                >
                  {STATUS_LABEL[server.status]}
                </span>
              </span>
              {server.schedulable ? null : (
                <span className="block pl-3.5 text-xs font-medium text-muted-foreground">
                  Cordoned
                </span>
              )}
            </Cell>
            <Cell>
              {server.role === 'control plane' ? 'Control plane' : 'Worker'}
            </Cell>
            <Cell>
              <span className="font-mono text-xs tabular-nums">
                {server.ip}
              </span>
            </Cell>
            <Cell>
              <span className="tabular-nums">
                {[
                  server.cpu ? `${server.cpu} CPU` : null,
                  server.ram,
                  server.storage,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </span>
            </Cell>
            <Cell>
              <span className="tabular-nums">{server.podCount}</span>
            </Cell>
            <Cell>
              <span className="font-mono text-xs">{server.version ?? '—'}</span>
            </Cell>
            <Cell>{renderActions(server)}</Cell>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
