import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { TONE_BG, type ChartTone } from '../utils/series';

type PanelProps = {
  title: string;
  /** Unit or aggregation hint beside the title, in mono (`cores`, `mean`). */
  hint?: string;
  /** Identity mark before the title: the panel's series tone. */
  tone?: ChartTone;
  action?: ReactNode;
  /** Content under the well, such as a legend. */
  footer?: ReactNode;
  className?: string;
  wellClassName?: string;
  children: ReactNode;
};

/**
 * A dashboard panel: a raised card with a title row and a sunken well that
 * holds the figure or chart.
 */
export const Panel = ({
  title,
  hint,
  tone = 'chart-1',
  action,
  footer,
  className,
  wellClassName,
  children,
}: PanelProps) => (
  <section
    className={cn(
      'flex min-w-0 flex-col gap-2 rounded-xl border border-edge-default bg-surface-raised p-1.5 pt-2.5',
      className,
    )}
  >
    <header className="flex min-h-5 items-center gap-2 px-1.5">
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-full', TONE_BG[tone])}
      />
      <h3 className="truncate text-[13px] leading-none font-medium tracking-tight text-fg-primary">
        {title}
      </h3>
      {hint ? (
        <span className="truncate font-mono text-[11px] leading-none text-fg-tertiary">
          {hint}
        </span>
      ) : null}
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </header>

    <div
      className={cn(
        'relative min-h-0 flex-1 overflow-hidden rounded-lg border border-edge-subtle bg-surface-sunken',
        wellClassName,
      )}
    >
      {children}
    </div>

    {footer ? <div className="px-1.5 pb-0.5">{footer}</div> : null}
  </section>
);
