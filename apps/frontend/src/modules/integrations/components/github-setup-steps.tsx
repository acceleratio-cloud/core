import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

const STEPS = [
  'Create a GitHub App',
  'Install it on your account',
  'Choose repositories on GitHub',
];

/** Where the operator is in connecting GitHub: 1 to 3, or 4 when done. */
export const GithubSetupSteps = ({ step }: { step: 1 | 2 | 3 | 4 }) => (
  <ol className="grid gap-2 sm:grid-cols-3" aria-label="Setup steps">
    {STEPS.map((label, index) => {
      const number = index + 1;
      const done = number < step;
      const current = number === step;

      return (
        <li
          key={label}
          aria-current={current ? 'step' : undefined}
          className={cn(
            'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]',
            current
              ? 'border-edge-control bg-surface-muted text-foreground'
              : 'border-border text-muted-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'grid size-5 shrink-0 place-items-center rounded-full border text-[11px] tabular-nums',
              done
                ? 'border-status-success/40 bg-status-success/10 text-status-success'
                : current
                  ? 'border-edge-control text-foreground'
                  : 'border-border',
            )}
          >
            {done ? <Check className="size-3" strokeWidth={2} /> : number}
          </span>
          <span className="min-w-0">
            {label}
            {done ? <span className="sr-only"> (done)</span> : null}
          </span>
        </li>
      );
    })}
  </ol>
);
