'use client';

import { useState } from 'react';
import {
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Tags,
  Trash2,
  Waves,
} from 'lucide-react';
import { sileo } from 'sileo';

import { getApiErrorMessage } from '@/api';
import { nodesApi } from '@/api/nodes';
import { buttonVariants } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import type { Server } from '../server';
import { DrainDialog } from './drain-dialog';
import { NodeMetadataDialog } from './node-metadata-dialog';
import { RemoveServerDialog } from './remove-server-dialog';

const MENU_ICON = 'size-4 text-muted-foreground';

/** Row menu of a server with the dialogs its actions open. */
export const ServerActions = ({
  server,
  removeBlockedReason,
  onChanged,
}: {
  server: Server;
  /** Set when the server cannot be removed; disables the action. */
  removeBlockedReason: string | null;
  onChanged: () => void;
}) => {
  const [dialog, setDialog] = useState<'drain' | 'remove' | 'metadata' | null>(
    null,
  );

  const toggleScheduling = async () => {
    try {
      if (server.schedulable) {
        await nodesApi.cordon(server.name);
        sileo.success({ title: `${server.name} cordoned` });
      } else {
        await nodesApi.uncordon(server.name);
        sileo.success({ title: `${server.name} accepts new pods again` });
      }

      onChanged();
    } catch (error) {
      sileo.error({
        title: `Could not update ${server.name}`,
        description: getApiErrorMessage(error),
      });
    }
  };

  const close = (open: boolean) => {
    if (!open) {
      setDialog(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${server.name}`}
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <MoreHorizontal
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-4"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52 min-w-52">
          <DropdownMenuItem onClick={toggleScheduling}>
            {server.schedulable ? (
              <PauseCircle
                aria-hidden="true"
                strokeWidth={1.75}
                className={MENU_ICON}
              />
            ) : (
              <PlayCircle
                aria-hidden="true"
                strokeWidth={1.75}
                className={MENU_ICON}
              />
            )}
            {server.schedulable ? 'Cordon' : 'Uncordon'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog('drain')}>
            <Waves
              aria-hidden="true"
              strokeWidth={1.75}
              className={MENU_ICON}
            />
            Drain
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog('metadata')}>
            <Tags aria-hidden="true" strokeWidth={1.75} className={MENU_ICON} />
            Labels and taints
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setDialog('remove')}
            disabled={removeBlockedReason !== null}
            title={removeBlockedReason ?? undefined}
            className="text-destructive data-highlighted:text-destructive"
          >
            <Trash2 aria-hidden="true" strokeWidth={1.75} className="size-4" />
            <span className="min-w-0">
              Remove server
              {removeBlockedReason ? (
                <span className="block text-xs font-normal text-muted-foreground">
                  {removeBlockedReason}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DrainDialog
        server={dialog === 'drain' ? server : null}
        onOpenChange={close}
        onChanged={onChanged}
      />
      <RemoveServerDialog
        server={dialog === 'remove' ? server : null}
        onOpenChange={close}
        onChanged={onChanged}
      />
      <NodeMetadataDialog
        server={dialog === 'metadata' ? server : null}
        onOpenChange={close}
        onSaved={onChanged}
      />
    </>
  );
};
