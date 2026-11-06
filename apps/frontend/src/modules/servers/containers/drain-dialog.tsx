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
import { Field, FieldError, FieldLabel } from '@/shared/components/ui/field';
import { Switch } from '@/shared/components/ui/switch';
import { DrainPlanSummary } from '../components/drain-plan-summary';
import { OperationProgress } from '../components/operation-progress';
import { useDrainPlan } from '../hooks/use-drain-plan';
import { useNodeOperation } from '../hooks/use-node-operation';
import type { Server } from '../server';

type DrainDialogProps = {
  server: Server | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
};

export const DrainDialog = ({
  server,
  onOpenChange,
  onChanged,
}: DrainDialogProps) => (
  <Dialog open={server !== null} onOpenChange={onOpenChange}>
    {server ? (
      <DrainDialogBody
        key={server.name}
        server={server}
        onChanged={onChanged}
      />
    ) : null}
  </Dialog>
);

const DrainDialogBody = ({
  server,
  onChanged,
}: {
  server: Server;
  onChanged: () => void;
}) => {
  const { plan, error: planError } = useDrainPlan(server.name);
  const [force, setForce] = useState(false);
  const [started, setStarted] = useState<NodeOperation | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { operation, error: pollError } = useNodeOperation(
    started ? server.name : null,
    started,
  );

  const running = operation?.status === 'running';
  const blocked = (plan?.drain_blockers.length ?? 0) > 0;

  const start = async () => {
    setIsStarting(true);
    setError(null);

    try {
      setStarted(await nodesApi.drain(server.name, { force }));
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
        <DialogTitle>Drain {server.name}</DialogTitle>
        <DialogDescription>
          Stops new pods from landing here and moves the running ones to other
          servers, one at a time and respecting disruption budgets.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        {operation ? (
          <OperationProgress operation={operation} error={pollError} />
        ) : plan ? (
          <>
            <DrainPlanSummary plan={plan} />
            {blocked ? (
              <Field orientation="horizontal">
                <FieldLabel htmlFor="drain-force">
                  Evict these pods anyway
                </FieldLabel>
                <Switch
                  id="drain-force"
                  checked={force}
                  onCheckedChange={setForce}
                />
              </Field>
            ) : null}
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
            loading={isStarting}
            disabled={!plan || (blocked && !force)}
            onClick={start}
          >
            Drain server
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
};
