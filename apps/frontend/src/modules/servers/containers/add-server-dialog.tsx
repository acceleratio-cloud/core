'use client';

import { useState } from 'react';
import { Check, CircleAlert, TriangleAlert } from 'lucide-react';

import type {
  NodeJoinRole,
  NodeOperation,
  NodePreflightResult,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { nodesApi } from '@/api/nodes';
import { cn } from '@/lib/utils';
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
  FieldGroup,
  FieldLabel,
} from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { OperationProgress } from '../components/operation-progress';
import {
  emptySshForm,
  SshAccessFields,
  toSshAccess,
  type SshForm,
} from '../components/ssh-access-fields';
import { useNodeOperation } from '../hooks/use-node-operation';

type AddServerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
};

export const AddServerDialog = ({
  open,
  onOpenChange,
  onChanged,
}: AddServerDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    {open ? <AddServerBody onChanged={onChanged} /> : null}
  </Dialog>
);

const ROLES: Array<{ value: NodeJoinRole; label: string; hint: string }> = [
  { value: 'worker', label: 'Worker', hint: 'Runs workloads.' },
  {
    value: 'server',
    label: 'Control plane',
    hint: 'Also joins etcd for high availability.',
  },
];

const AddServerBody = ({ onChanged }: { onChanged: () => void }) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState<NodeJoinRole>('worker');
  const [nodeIp, setNodeIp] = useState('');
  const [ssh, setSsh] = useState<SshForm>(emptySshForm);
  const [checks, setChecks] = useState<NodePreflightResult | null>(null);
  const [started, setStarted] = useState<NodeOperation | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { operation, error: pollError } = useNodeOperation(
    started ? name.trim() : null,
    started,
  );

  const running = operation?.status === 'running';
  const filled = name.trim() && ssh.host.trim() && ssh.privateKey.trim();

  const runChecks = async () => {
    setIsBusy(true);
    setError(null);

    try {
      setChecks(await nodesApi.preflight({ ssh: toSshAccess(ssh), role }));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setIsBusy(false);
    }
  };

  const add = async () => {
    if (!checks) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      setStarted(
        await nodesApi.add({
          name: name.trim(),
          role,
          node_ip: nodeIp.trim() || undefined,
          // Pins the key shown with the checks: the join token is only sent
          // to the server the operator verified.
          ssh: { ...toSshAccess(ssh), host_key: checks.host_key },
        }),
      );
      onChanged();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <DialogContent showCloseButton={!running} className={"max-w-2xl"}>
      <DialogHeader>
        <DialogTitle>Add server</DialogTitle>
        <DialogDescription>
          Connects over SSH, checks the server, installs k3s and joins it to
          this cluster.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto px-px">
        {operation ? (
          <OperationProgress operation={operation} error={pollError} />
        ) : checks ? (
          <Checks result={checks} />
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="add-server-name">Server name</FieldLabel>
              <Input
                id="add-server-name"
                autoComplete="off"
                spellCheck={false}
                placeholder="worker-2"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldDescription>
                Lowercase letters, digits, hyphens and dots.
              </FieldDescription>
            </Field>

            <Field>
              <span className="text-sm leading-snug font-medium">Role</span>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                {ROLES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={role === item.value}
                    onClick={() => setRole(item.value)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      role === item.value
                        ? 'border-foreground bg-surface-muted'
                        : 'border-border hover:bg-surface-muted',
                    )}
                  >
                    <span className="block font-medium">{item.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {item.hint}
                    </span>
                  </button>
                ))}
              </div>
            </Field>

            <SshAccessFields value={ssh} onChange={setSsh} />

            <Field>
              <FieldLabel htmlFor="add-server-ip">
                Cluster network address
              </FieldLabel>
              <Input
                id="add-server-ip"
                autoComplete="off"
                spellCheck={false}
                placeholder="Same as the SSH address"
                value={nodeIp}
                onChange={(event) => setNodeIp(event.target.value)}
              />
              <FieldDescription>
                Set it when the other servers reach this one on a private
                address.
              </FieldDescription>
            </Field>
          </FieldGroup>
        )}

        <FieldError>{error}</FieldError>
      </div>

      <DialogFooter>
        {checks && !operation ? (
          <Button
            type="button"
            variant="ghost"
            disabled={isBusy}
            onClick={() => setChecks(null)}
          >
            Back
          </Button>
        ) : (
          <DialogClose
            render={<Button type="button" variant="ghost" />}
            disabled={running}
            onClick={onChanged}
          >
            {operation ? 'Close' : 'Cancel'}
          </DialogClose>
        )}
        {operation ? null : checks ? (
          <Button
            type="button"
            loading={isBusy}
            disabled={!checks.ok}
            onClick={add}
          >
            Add server
          </Button>
        ) : (
          <Button
            type="button"
            loading={isBusy}
            disabled={!filled}
            onClick={runChecks}
          >
            Check server
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
};

const Checks = ({ result }: { result: NodePreflightResult }) => (
  <div className="space-y-3">
    <p
      role="status"
      className={cn('text-sm font-medium', !result.ok && 'text-destructive')}
    >
      {result.ok
        ? 'The server meets the requirements.'
        : 'The server does not meet the requirements.'}
    </p>
    <div className="rounded-md border border-border px-3 py-2 text-sm">
      <span className="block font-medium">Host key</span>
      <code className="block font-mono text-xs break-all">
        {result.host_key}
      </code>
      <span className="mt-1 block text-xs text-muted-foreground">
        Compare it with <code>ssh-keygen -lf</code> on the server&apos;s host
        key before adding it. The join token is only sent to this key.
      </span>
    </div>
    <ul className="divide-y divide-border rounded-md border border-border">
      {result.checks.map((check) => {
        const Icon =
          check.status === 'pass'
            ? Check
            : check.status === 'warn'
              ? TriangleAlert
              : CircleAlert;

        return (
          <li
            key={check.id}
            className="flex items-start gap-2 px-3 py-2 text-sm"
          >
            <Icon
              strokeWidth={1.75}
              aria-hidden="true"
              className={cn(
                'mt-0.5 size-4 shrink-0',
                check.status === 'fail' && 'text-destructive',
              )}
            />
            <span className="min-w-0 flex-1">
              {check.label}
              {check.detail ? (
                <span className="block text-xs text-muted-foreground">
                  {check.detail}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                'text-xs',
                check.status === 'fail'
                  ? 'font-medium text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {check.status === 'pass'
                ? 'OK'
                : check.status === 'warn'
                  ? 'Warning'
                  : 'Failed'}
            </span>
          </li>
        );
      })}
    </ul>
  </div>
);
