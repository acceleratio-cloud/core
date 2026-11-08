import type { Integration } from '../catalog';
import { cn } from '@/lib/utils';

/** Brand mark on a quiet tile, so every provider sits on the same footing. */
export const IntegrationIcon = ({
  integration,
  className,
}: {
  integration: Integration;
  className?: string;
}) => {
  const Icon = integration.icon;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-surface-muted',
        className,
      )}
    >
      <Icon className="size-5 text-foreground" />
    </span>
  );
};
