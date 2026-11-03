import { useId, type ReactNode } from 'react';
import { CircleAlert, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { CopyButton } from './copy-button';

/** Vertical rhythm between the sections of one tab. */
export const DetailStack = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <div className={cn('flex flex-col gap-5', className)}>{children}</div>;

/**
 * A titled group. The title sits on the panel above the card, so the card
 * itself is just rows divided by hairlines.
 */
export const DetailSection = ({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={className}>
      <h3
        id={headingId}
        className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-fg-secondary"
      >
        {Icon ? (
          <Icon
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-3.5 text-fg-tertiary"
          />
        ) : null}
        {title}
      </h3>
      <div className="overflow-hidden rounded-lg border border-edge-default bg-surface-raised">
        {children}
      </div>
    </section>
  );
};

/** Rows of one section, separated by hairlines. */
export const PropertyList = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <dl className={cn('divide-y divide-edge-subtle', className)}>{children}</dl>
);

const labelClassName = 'text-xs leading-5 text-fg-tertiary';

/** One line: label on the left, a short value on the right. */
export const PropertyRow = ({
  label,
  children,
  mono = false,
  className,
}: {
  label: string;
  children: ReactNode;
  /** Set for identifiers and other machine values. */
  mono?: boolean;
  className?: string;
}) => (
  <div className="flex min-h-10 items-center justify-between gap-4 px-3 py-2">
    <dt className={cn(labelClassName, 'shrink-0')}>{label}</dt>
    <dd
      className={cn(
        'min-w-0 text-right text-xs leading-5 text-fg-primary',
        mono && 'font-mono',
        className,
      )}
    >
      {children}
    </dd>
  </div>
);

/**
 * A machine value that may be long. The label sits above and the value wraps
 * in full, so nothing is cut off, with a copy button beside it.
 */
export const CopyableProperty = ({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  /** Replaces the plain value when a richer rendering is needed. */
  children?: ReactNode;
}) => (
  <div className="flex items-start gap-2 py-2.5 pr-2 pl-3">
    <div className="min-w-0 flex-1">
      <dt className={labelClassName}>{label}</dt>
      <dd className="mt-0.5 font-mono text-xs leading-5 break-all text-fg-primary">
        {children ?? value}
      </dd>
    </div>
    <CopyButton
      value={value}
      label={label.toLowerCase()}
      className="mt-2.5 text-fg-tertiary"
    />
  </div>
);

/** Small mono token, for values like an image tag. */
export const MonoBadge = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex max-w-full items-center rounded-sm border border-edge-default bg-surface-sunken px-1.5 font-mono text-xs leading-5 text-fg-secondary">
    {children}
  </span>
);

/** Relative time with the exact timestamp on hover and for assistive tech. */
export const TimeProperty = ({
  label,
  value,
  emptyLabel,
}: {
  label: string;
  value: string | null;
  emptyLabel?: string;
}) => (
  <PropertyRow label={label} className="tabular-nums">
    {value ? (
      <time dateTime={value} title={formatAbsoluteTime(value)}>
        {formatRelativeTime(value)}
      </time>
    ) : (
      <span className="text-fg-tertiary">{emptyLabel ?? '—'}</span>
    )}
  </PropertyRow>
);

/**
 * The node card's failure well, shown in full. Red marks only the icon and
 * title; the message is neutral text so it stays readable, and it can be
 * copied for a bug report.
 */
export const DetailNotice = ({
  title,
  message,
}: {
  title: string;
  message: string;
}) => (
  <div
    role="alert"
    className="rounded-lg border border-status-danger/40 bg-status-danger/10"
  >
    <div className="flex h-9 items-center gap-2 pr-1.5 pl-3">
      <CircleAlert
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3.5 shrink-0 text-status-danger"
      />
      <p className="min-w-0 flex-1 truncate text-xs font-medium text-status-danger">
        {title}
      </p>
      <CopyButton
        value={message}
        label="error message"
        className="text-fg-secondary"
      />
    </div>
    <p className="px-3 pb-3 text-xs leading-relaxed break-words text-fg-secondary select-text">
      {message}
    </p>
  </div>
);
