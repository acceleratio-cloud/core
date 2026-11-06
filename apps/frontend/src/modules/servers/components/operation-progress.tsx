import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';

import type { NodeOperation } from '@acceleratio/shared';
import { cn } from '@/lib/utils';

const STEPS: Record<string, string> = {
  connect: 'Connecting over SSH',
  preflight: 'Checking requirements',
  install: 'Installing k3s',
  wait_ready: 'Waiting for the node to become Ready',
  cordon: 'Cordoning',
  evict: 'Evicting pods',
  delete: 'Removing from the cluster',
  uninstall: 'Uninstalling k3s',
};

/** Status, counters and log of a node operation. */
export const OperationProgress = ({
  operation,
  error,
}: {
  operation: NodeOperation;
  error?: string | null;
}) => {
  const running = operation.status === 'running';
  const Icon = running
    ? Loader2
    : operation.status === 'succeeded'
      ? CheckCircle2
      : CircleAlert;
  const step = operation.step
    ? (STEPS[operation.step] ?? operation.step)
    : null;

  return (
    <div className="space-y-3" aria-busy={running}>
      <p
        role="status"
        className={cn(
          'flex items-start gap-2 text-sm',
          operation.status === 'failed' && 'text-destructive',
        )}
      >
        <Icon
          strokeWidth={1.75}
          aria-hidden="true"
          className={cn(
            'mt-0.5 size-4 shrink-0',
            running && 'animate-spin motion-reduce:animate-none',
          )}
        />
        <span className="min-w-0">
          <span className="font-medium">
            {operation.status === 'running'
              ? (step ?? 'Working')
              : operation.status === 'succeeded'
                ? 'Done'
                : 'Failed'}
          </span>
          {operation.message ? (
            <span className="block text-muted-foreground">
              {operation.message}
            </span>
          ) : null}
        </span>
      </p>

      {operation.type !== 'add' &&
      (operation.evicted > 0 || operation.remaining > 0) ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {operation.evicted} evicted · {operation.remaining} remaining
        </p>
      ) : null}

      {operation.stuck.length > 0 ? (
        <div className="text-xs">
          <p className="font-medium text-destructive">
            Pods that did not leave
          </p>
          <ul className="mt-1 font-mono text-muted-foreground">
            {operation.stuck.map((pod) => (
              <li key={pod} className="truncate" title={pod}>
                {pod}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {operation.log.length > 0 ? (
        <pre
          tabIndex={0}
          aria-label="Operation log"
          className="max-h-48 overflow-auto rounded-md border border-border bg-surface-muted p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground"
        >
          {operation.log.join('\n')}
        </pre>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
};
