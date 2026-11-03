import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

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

/** A titled block. The title sits outside the group, like a settings list. */
export const DetailSection = ({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) => {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cn('flex flex-col gap-2', className)}
    >
      <h3
        id={headingId}
        className="px-1 text-xs leading-none font-medium text-muted-foreground"
      >
        {title}
      </h3>
      {children}
    </section>
  );
};

/** Inset group of label/value rows divided by hairlines. */
export const PropertyList = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <dl
    className={cn(
      'divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-card',
      className,
    )}
  >
    {children}
  </dl>
);

const rowClassName = 'group/row flex items-start gap-3 px-3 py-2';
const labelClassName = 'w-24 shrink-0 text-xs leading-5 text-muted-foreground';
const valueClassName = 'min-w-0 flex-1 text-xs leading-5 text-foreground';

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

/** Identifier shown in mono. The copy button appears on hover or focus. */
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
    <dd className={cn(valueClassName, 'flex items-start gap-2')}>
      <span className="min-w-0 flex-1 font-mono break-all text-nowrap truncate">
        {children ?? value}
      </span>
      <CopyButton
        value={value}
        label={label.toLowerCase()}
        className="-my-0.5 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100"
      />
    </dd>
  </div>
);

/** Small mono token, for values like an image tag. */
export const MonoBadge = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center rounded-sm border border-border bg-muted px-1.5 font-mono text-[11px] leading-5 text-foreground">
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

/** Inline alert. Failure is the only state allowed to take Signal Red. */
export const DetailNotice = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <div
    role="alert"
    className="flex flex-col gap-1 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5"
  >
    <p className="text-xs leading-none font-medium text-destructive">{title}</p>
    <p className="text-xs leading-relaxed break-words text-destructive/90">
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
  <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-12 text-center">
    <span
      aria-hidden="true"
      className="mb-2 flex size-10 items-center justify-center rounded-lg border border-border bg-card"
    >
      <Icon strokeWidth={1.5} className="size-[18px] text-muted-foreground" />
    </span>
    <p className="text-sm leading-none font-medium text-foreground">{title}</p>
    <p className="max-w-60 text-xs leading-relaxed text-muted-foreground">
      {description}
    </p>
  </div>
);
