import type { NodeDrainPlan } from '@acceleratio/shared';

/** What a drain will do, as a short list the operator can check. */
export const DrainPlanSummary = ({ plan }: { plan: NodeDrainPlan }) => {
  const evict = plan.pods.filter((pod) => pod.action === 'evict');
  const skipped = plan.pods.filter((pod) => pod.action === 'skip');
  const waiting = evict.filter((pod) => pod.pdb_blocked);

  return (
    <div className="space-y-3 text-sm">
      <p>
        <span className="font-medium tabular-nums">{evict.length}</span>{' '}
        {evict.length === 1 ? 'pod' : 'pods'} will be moved to other servers.
        {skipped.length > 0 ? (
          <span className="text-muted-foreground">
            {' '}
            {skipped.length} stay (DaemonSet, static or finished).
          </span>
        ) : null}
      </p>

      {waiting.length > 0 ? (
        <p className="text-muted-foreground">
          {waiting.length} {waiting.length === 1 ? 'pod is' : 'pods are'}{' '}
          protected by a disruption budget and leave only once a replica runs
          elsewhere; a drain waits for them until the timeout.
        </p>
      ) : null}

      {evict.length > 0 ? (
        <ul className="max-h-32 overflow-auto font-mono text-xs text-muted-foreground">
          {evict.map((pod) => (
            <li
              key={`${pod.namespace}/${pod.name}`}
              className="truncate"
              title={`${pod.namespace}/${pod.name}`}
            >
              {pod.namespace}/{pod.name}
              {pod.pdb_blocked ? ' (budget)' : ''}
            </li>
          ))}
        </ul>
      ) : null}

      {plan.drain_blockers.length > 0 ? (
        <div>
          <p className="font-medium text-destructive">
            Data on this server would be lost
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
            {plan.drain_blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};
