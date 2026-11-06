import { CircleAlert, CircleCheck, Info, LoaderCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { PlatformStatusTone } from '../utils/platform-update';

const ICONS = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  danger: CircleAlert,
} as const;

type PlatformStatusBadgeProps = {
  tone: PlatformStatusTone;
  label: string;
  /** Spin a loader instead of the tone's icon. */
  busy?: boolean;
  className?: string;
};

/** A status token: icon and label, colored only when it carries meaning. */
export const PlatformStatusBadge = ({
  tone,
  label,
  busy = false,
  className,
}: PlatformStatusBadgeProps) => {
  const Icon = busy ? LoaderCircle : ICONS[tone];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-medium',
        tone === 'neutral' && 'border-border text-muted-foreground',
        tone === 'info' && 'border-brand-fg/30 bg-brand-fg/5 text-brand-fg',
        tone === 'success' &&
          'border-status-success/30 bg-status-success/5 text-status-success',
        tone === 'danger' &&
          'border-status-danger/30 bg-status-danger/5 text-status-danger',
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={2}
        className={cn(
          'size-3.5 shrink-0',
          busy && 'animate-spin motion-reduce:animate-none',
        )}
      />
      {label}
    </span>
  );
};
