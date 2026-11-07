import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

type LogsMessageProps = {
  icon: ReactNode;
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
  onRetry?: () => void;
  children?: ReactNode;
};

/** A centered state inside the log area: empty, failed or unavailable. */
export const LogsMessage = ({
  icon,
  title,
  message,
  action,
  onRetry,
  children,
}: LogsMessageProps) => (
  <div className="flex flex-1 items-center justify-center p-6">
    <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-surface-muted text-fg-secondary">
        {icon}
      </span>
      <h2 className="text-base font-medium tracking-tight text-fg-primary">
        {title}
      </h2>
      <p className="text-sm text-fg-secondary">{message}</p>
      {children}
      {action || onRetry ? (
        <div className="mt-1 flex gap-2">
          {action ? (
            <Button type="button" variant="outline" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
          {onRetry ? (
            <Button type="button" variant="outline" onClick={onRetry}>
              <RefreshCw aria-hidden="true" strokeWidth={1.75} />
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  </div>
);
