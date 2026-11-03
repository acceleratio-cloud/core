'use client';

import { useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
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
 * The non-modal popup stays inside the canvas. Base UI owns transition
 * presence and Escape handling, including nested confirmation dialogs.
 */
export const WorkloadDetails = ({
  workload,
  onClose,
}: WorkloadDetailsProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayedWorkload, setDisplayedWorkload] = useState(workload);

  // Keep the last selection visible until the closing transition completes.
  if (workload && workload !== displayedWorkload) {
    setDisplayedWorkload(workload);
  }

  const view = displayedWorkload
    ? resolveWorkloadDetailView(displayedWorkload)
    : null;

  return (
    <Dialog.Root
      open={workload !== null}
      modal={false}
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      onOpenChangeComplete={(open) => {
        if (!open) {
          setDisplayedWorkload(null);
        }
      }}
    >
      <div
        ref={containerRef}
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      />
      <Dialog.Portal container={containerRef}>
        {displayedWorkload && view ? (
          <Dialog.Popup
            render={<aside />}
            aria-label="Service details"
            initialFocus={false}
            finalFocus={false}
            inert={!workload}
            className={cn(
              'pointer-events-auto absolute top-16 right-3 bottom-3 flex w-[min(560px,calc(100%-1.5rem))] flex-col overflow-hidden',
              'rounded-lg border border-edge-default bg-surface-raised text-fg-primary shadow-float outline-none',
              'transition-[translate,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
              'data-[starting-style]:translate-x-[calc(100%+1rem)] data-[starting-style]:opacity-0',
              'data-[ending-style]:translate-x-[calc(100%+1rem)] data-[ending-style]:opacity-0',
            )}
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-edge-subtle bg-surface-muted/40 p-4">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-edge-default bg-surface-sunken [&_svg]:size-5"
              >
                {view.icon}
              </span>
              <div className="min-w-0 flex-1">
                <Dialog.Title
                  render={<h2 />}
                  title={displayedWorkload.name}
                  className="truncate text-lg leading-tight font-semibold tracking-tight"
                >
                  {displayedWorkload.name}
                </Dialog.Title>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-tertiary">
                  <span>{view.kindLabel}</span>
                  <span
                    aria-hidden="true"
                    className="h-3 w-px bg-edge-default"
                  />
                  <WorkloadStatus status={displayedWorkload.status} />
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close service details"
                onClick={onClose}
                className="shrink-0 self-start text-fg-tertiary"
              >
                <X aria-hidden="true" strokeWidth={1.75} />
              </Button>
            </header>

            <Tabs
              key={`tabs-${displayedWorkload.id}`}
              defaultValue={view.tabs[0]?.id}
              className="flex min-h-0 flex-1 flex-col"
            >
              {view.tabs.length > 1 ? (
                <TabsList
                  aria-label="Service sections"
                  className="relative shrink-0 gap-5 border-edge-subtle px-4"
                >
                  {view.tabs.map(({ id, label, icon: Icon }) => (
                    <TabsTrigger
                      key={id}
                      value={id}
                      className={cn(
                        'mb-0 h-10 gap-2 px-0 text-sm after:hidden [&_svg]:size-3.5',
                        'focus-visible:rounded-sm focus-visible:ring-2 motion-reduce:transition-none',
                        'data-active:text-fg-primary',
                      )}
                    >
                      <Icon aria-hidden="true" strokeWidth={1.75} />
                      {label}
                    </TabsTrigger>
                  ))}
                  <TabsPrimitive.Indicator
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-t-full bg-fg-primary transition-[translate,width] duration-200 ease-out motion-reduce:transition-none"
                  />
                </TabsList>
              ) : null}

              {view.tabs.map(({ id, content }) => (
                <TabsContent
                  key={id}
                  value={id}
                  className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-surface-panel p-4 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {content}
                </TabsContent>
              ))}
            </Tabs>

            <div key={`actions-${displayedWorkload.id}`} className="contents">
              {view.actions}
            </div>
          </Dialog.Popup>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  );
};
