'use client';

import { useState } from 'react';

import type { NodeOperation } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { nodesApi } from '@/api/nodes';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Switch } from '@/shared/components/ui/switch';
import { DrainPlanSummary } from '../components/drain-plan-summary';
import { OperationProgress } from '../components/operation-progress';
import {
  emptySshForm,
  SshAccessFields,
  toSshAccess,
  type SshForm,
} from '../components/ssh-access-fields';
import { useDrainPlan } from '../hooks/use-drain-plan';
import { useNodeOperation } from '../hooks/use-node-operation';
import type { Server } from '../server';

type RemoveServerDialogProps = {
  server: Server | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
};

export const RemoveServerDialog = ({
  server,
  onOpenChange,
  onChanged,
}: RemoveServerDialogProps) => (
  <Dialog open={server !== null} onOpenChange={onOpenChange}>
    {server ? (
      <RemoveServerBody
        key={server.name}
        server={server}
        onChanged={onChanged}
      />
    ) : null}
  </Dialog>
);

const RemoveServerBody = ({
  server,
  onChanged,
}: {
  server: Server;
  onChanged: () => void;
}) => {
  const { plan, error: planError } = useDrainPlan(server.name);
  const [confirmation, setConfirmation] = useState('');
  const [force, setForce] = useState(false);
  const [uninstall, setUninstall] = useState(false);
  const [ssh, setSsh] = useState<SshForm>({
    ...emptySshForm,
    host: server.ip === '—' ? '' : server.ip,
  });
  const [started, setStarted] = useState<NodeOperation | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { operation, error: pollError } = useNodeOperation(
    started ? server.name : null,
    started,
  );

  const running = operation?.status === 'running';
  const hardBlockers = plan?.delete_blockers ?? [];
  const dataBlockers = plan?.drain_blockers ?? [];
  const needsForce = dataBlockers.length > 0;
  const canStart =
    plan !== null &&
    hardBlockers.length === 0 &&
    (!needsForce || force) &&
    confirmation === server.name &&
    (!uninstall || (ssh.host.trim() && ssh.privateKey.trim()));

  const start = async () => {
    setIsStarting(true);
    setError(null);

    try {
      setStarted(
        await nodesApi.remove(server.name, {
          confirm_name: confirmation,
          force,
          ssh: uninstall ? toSshAccess(ssh) : undefined,
        }),
      );
      onChanged();
    } catch (startError) {
      setError(getApiErrorMessage(startError));
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <DialogContent showCloseButton={!running}>
      <DialogHeader>
        <DialogTitle>Remove {server.name}</DialogTitle>
        <DialogDescription>
          Drains the server, deletes it from the cluster and uninstalls k3s
          over SSH. Without SSH access, stop k3s on a worker yourself or it
          registers again. This cannot be undone.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        {operation ? (
          <OperationProgress operation={operation} error={pollError} />
        ) : plan ? (
          <>
            <DrainPlanSummary plan={plan} />

            {hardBlockers.length > 0 ? (
              <div className="text-sm">
                <p className="font-medium text-destructive">
                  This server cannot be removed yet
                </p>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {hardBlockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {needsForce ? (
              <Field orientation="horizontal">
                <FieldLabel htmlFor="remove-force">
                  Evict pods with local data anyway
                </FieldLabel>
                <Switch
                  id="remove-force"
                  checked={force}
                  onCheckedChange={setForce}
                />
              </Field>
            ) : null}

            <Field orientation="horizontal">
              <FieldLabel htmlFor="remove-uninstall">
                Uninstall k3s over SSH
              </FieldLabel>
              <Switch
                id="remove-uninstall"
                checked={uninstall}
                onCheckedChange={setUninstall}
              />
            </Field>
            {uninstall ? (
              <SshAccessFields value={ssh} onChange={setSsh} />
            ) : (
              <FieldDescription>
                Without SSH access k3s stays installed on the server.
              </FieldDescription>
            )}

            <Field>
              <FieldLabel htmlFor="remove-confirm">
                Type {server.name} to confirm
              </FieldLabel>
              <Input
                id="remove-confirm"
                autoComplete="off"
                spellCheck={false}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
          </>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {planError ?? 'Checking what runs on this server...'}
          </p>
        )}

        <FieldError>{error}</FieldError>
      </div>

      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="ghost" />}
          disabled={running}
          onClick={onChanged}
        >
          {operation ? 'Close' : 'Cancel'}
        </DialogClose>
        {operation ? null : (
          <Button
            type="button"
            variant="destructive"
            loading={isStarting}
            disabled={!canStart}
            onClick={start}
          >
            Remove server
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
};
