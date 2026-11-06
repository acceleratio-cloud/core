'use client';

import { useState } from 'react';

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
import { Textarea } from '@/shared/components/ui/textarea';
import type { Server } from '../server';
import {
  formatLabels,
  formatTaints,
  parseLabels,
  parseTaints,
} from '../utils/node-metadata';

type NodeMetadataDialogProps = {
  server: Server | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export const NodeMetadataDialog = ({
  server,
  onOpenChange,
  onSaved,
}: NodeMetadataDialogProps) => (
  <Dialog open={server !== null} onOpenChange={onOpenChange}>
    {server ? (
      <NodeMetadataBody
        key={server.name}
        server={server}
        onClose={() => onOpenChange(false)}
        onSaved={onSaved}
      />
    ) : null}
  </Dialog>
);

const NodeMetadataBody = ({
  server,
  onClose,
  onSaved,
}: {
  server: Server;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [labels, setLabels] = useState(formatLabels(server.labels));
  const [taints, setTaints] = useState(formatTaints(server.taints));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const parsedTaints = parseTaints(taints);

      await nodesApi.updateLabels(server.name, { labels: parseLabels(labels) });
      await nodesApi.updateTaints(server.name, { taints: parsedTaints });
      onSaved();
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error && !('response' in saveError)
          ? saveError.message
          : getApiErrorMessage(saveError),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Labels and taints of {server.name}</DialogTitle>
        <DialogDescription>
          Select a server in a service&apos;s node selector by label. A taint
          keeps pods away unless they tolerate it. Labels managed by the cluster
          are kept.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        <Field>
          <FieldLabel htmlFor="node-labels">Labels</FieldLabel>
          <Textarea
            id="node-labels"
            rows={4}
            spellCheck={false}
            autoComplete="off"
            placeholder="pool=gpu"
            className="font-mono text-xs"
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
          />
          <FieldDescription>One key=value per line.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="node-taints">Taints</FieldLabel>
          <Textarea
            id="node-taints"
            rows={3}
            spellCheck={false}
            autoComplete="off"
            placeholder="dedicated=db:NoSchedule"
            className="font-mono text-xs"
            value={taints}
            onChange={(event) => setTaints(event.target.value)}
          />
          <FieldDescription>
            One key=value:Effect per line. Effects: NoSchedule,
            PreferNoSchedule, NoExecute.
          </FieldDescription>
        </Field>

        <FieldError>{error}</FieldError>
      </div>

      <DialogFooter>
        <DialogClose
          render={<Button type="button" variant="ghost" />}
          disabled={isSaving}
        >
          Cancel
        </DialogClose>
        <Button type="button" loading={isSaving} onClick={save}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};
