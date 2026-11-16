import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** An empty tab: what would be here, and the action that fills it. */
export const EmptyPanel = ({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-center rounded-xl border border-dashed border-edge-default px-6 py-12 text-center">
    <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface-raised text-muted-foreground">
      <Icon aria-hidden="true" strokeWidth={1.75} className="size-4" />
    </span>
    <h3 className="mt-4 text-sm font-medium text-foreground">{title}</h3>
    <p className="mt-1.5 max-w-sm text-sm text-balance text-muted-foreground">
      {description}
    </p>
    {action ? <div className="mt-5">{action}</div> : null}
  </div>
);
