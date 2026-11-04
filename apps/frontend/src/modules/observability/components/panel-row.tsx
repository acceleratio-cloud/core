'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

type PanelRowProps = {
  title: string;
  panelCount: number;
  className?: string;
  children: ReactNode;
};

/**
 * A collapsible group of panels. The body collapses on a grid-row transition,
 * so it animates to its natural height without measuring.
 */
export const PanelRow = ({
  title,
  panelCount,
  className,
  children,
}: PanelRowProps) => {
  const [open, setOpen] = useState(true);
  const bodyId = useId();

  return (
    <section className="flex flex-col">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className="group flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-foreground/60"
        >
          <ChevronDown
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn(
              'size-3.5 text-fg-tertiary transition-transform duration-200 motion-reduce:transition-none',
              !open && '-rotate-90',
            )}
          />
          <span className="text-sm font-medium tracking-tight text-fg-primary">
            {title}
          </span>
          <span className="font-mono text-[11px] text-fg-tertiary">
            ({panelCount} {panelCount === 1 ? 'panel' : 'panels'})
          </span>
        </button>
      </h2>

      <div
        id={bodyId}
        inert={!open}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={cn('grid gap-3 pt-1.5 pb-1', className)}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
};
