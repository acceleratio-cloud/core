'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
import { Button } from '@/shared/components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';
import { resolveWorkloadDetailView } from './workload-detail-views/resolve-workload-detail-view';

type WorkloadDetailsProps = {
  workload: Workload | null;
  onClose: () => void;
};

/**
 * Inspector for the service selected on the project canvas. The canvas owns
 * the selection. This shell owns the frame (header, tabs, footer) and stays
 * type-agnostic: the tabs, icon and actions come from the view that
 * `resolveWorkloadDetailView` picks for the workload's type.
 *
 * It floats over the canvas, so it takes the same lift as the other floating
 * surfaces (menus, dialogs) and nothing else on the page does.
 */
export const WorkloadDetails = ({
  workload,
  onClose,
}: WorkloadDetailsProps) => {
  useEffect(() => {
    if (!workload) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [workload, onClose]);

  if (!workload) {
    return null;
  }

  const view = resolveWorkloadDetailView(workload);
  const hasMultipleTabs = view.tabs.length > 1;

  return (
    <aside
      aria-label="Service details"
      className={cn(
        'absolute top-16 right-3 z-10 flex bottom-3 w-[min(680px,calc(100vw-2rem))] flex-col overflow-hidden',
        'rounded-lg border border-border bg-popover text-popover-foreground shadow-sm',
        'animate-in fade-in slide-in-from-right-1 duration-150 ease-out motion-reduce:animate-none',
      )}
    >
      <header className="flex border-b shrink-0 items-center gap-3 px-4 py-2">
        {view.icon}
        <h2
          title={workload.name}
          className="truncate text-[15px] leading-tight font-medium tracking-tight text-foreground"
        >
          {workload.name}
        </h2>
        <WorkloadStatus status={workload.status} className="min-w-0" />

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close service details"
          onClick={onClose}
          className="-mr-1.5 ml-auto shrink-0 self-start text-muted-foreground"
        >
          <X aria-hidden="true" strokeWidth={1.75} />
        </Button>
      </header>

      <Tabs
        key={`tabs-${workload.id}`}
        defaultValue={view.tabs[0]?.id}
        className="flex min-h-0 flex-1 flex-col mt-2"
      >
        {hasMultipleTabs ? (
          <TabsList
            aria-label="Service sections"
            className="mx-5 shrink-0 gap-0.5 rounded-lg border-0 bg-muted p-0.5"
          >
            {view.tabs.map(({ id, label, icon: Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                className={cn(
                  'm-0 h-7 flex-1 justify-center rounded-md border border-transparent px-2 text-xs after:hidden',
                  'data-active:border-border data-active:bg-card data-active:text-foreground [&_svg]:size-3.5',
                )}
              >
                <Icon aria-hidden="true" strokeWidth={1.75} />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        ) : null}

        {view.tabs.map(({ id, content }) => (
          <TabsContent
            key={id}
            value={id}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pt-4 pb-5"
          >
            {content}
          </TabsContent>
        ))}
      </Tabs>

      <div key={`actions-${workload.id}`} className="contents">
        {view.actions}
      </div>
    </aside>
  );
};
