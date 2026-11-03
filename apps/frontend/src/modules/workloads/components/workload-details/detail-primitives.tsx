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
}) => <div className={cn('flex flex-col gap-4', className)}>{children}</div>;

/** A framed section with the same muted header as a canvas node card. */
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
    <section
      aria-labelledby={headingId}
      className={cn(
        'overflow-hidden rounded-lg border border-edge-default bg-surface-raised',
        className,
      )}
    >
      <h3
        id={headingId}
        className="flex items-center gap-2 border-b border-edge-subtle bg-surface-muted/40 px-3 py-2.5 text-xs font-medium text-fg-secondary"
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
      {children}
    </section>
  );
};

/** Compact label/value rows, inset beneath a section header. */
export const PropertyList = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <dl className={cn('flex flex-col px-3 py-1.5', className)}>{children}</dl>
);

const rowClassName = 'group/row flex min-h-9 items-center gap-3 py-1.5';
const labelClassName = 'w-28 shrink-0 text-xs leading-5 text-fg-tertiary';
const valueClassName =
  'min-w-0 flex-1 text-right font-mono text-xs leading-5 text-fg-primary';

export const PropertyRow = ({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) => (
  <div className={rowClassName}>
    <dt className={labelClassName}>{label}</dt>
    <dd className={cn(valueClassName, className)}>{children}</dd>
  </div>
);

/** Identifier shown in mono, with a persistent copy affordance. */
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
  <div className={rowClassName}>
    <dt className={labelClassName}>{label}</dt>
    <dd className={cn(valueClassName, 'flex items-center gap-1.5')}>
      <span title={value} className="min-w-0 flex-1 truncate">
        {children ?? value}
      </span>
      <CopyButton
        value={value}
        label={label.toLowerCase()}
        className="-my-0.5 text-fg-tertiary"
      />
    </dd>
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
      <span className="text-muted-foreground">{emptyLabel ?? '—'}</span>
    )}
  </PropertyRow>
);

/** The node card's failure well, with neutral, readable message text. */
export const DetailNotice = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <div
    role="alert"
    className="flex flex-col gap-2 rounded-lg border border-status-danger/50 bg-status-danger/10 p-3"
  >
    <p className="flex items-center gap-2 text-xs font-medium text-status-danger">
      <CircleAlert
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3.5 shrink-0"
      />
      {title}
    </p>
    <p className="text-xs leading-relaxed break-words text-fg-secondary">
      {children}
    </p>
  </div>
);

export const DetailEmptyState = ({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-edge-default bg-surface-raised px-4 py-12 text-center">
    <span
      aria-hidden="true"
      className="mb-2 flex size-10 items-center justify-center rounded-lg border border-edge-default bg-surface-sunken"
    >
      <Icon strokeWidth={1.75} className="size-5 text-fg-tertiary" />
    </span>
    <p className="text-sm font-medium text-fg-primary">{title}</p>
    <p className="max-w-60 text-xs leading-relaxed text-fg-tertiary">
      {description}
    </p>
  </div>
);
