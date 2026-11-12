'use client';

import { useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';

import type { Workload } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { WorkloadIconButton } from '@/modules/workloads/containers/workload-icon-button';
import { WorkloadHeader } from '@/modules/workloads/components/workload-details/workload-header';
import { isContainerWorkload } from '@/modules/workloads/utils/workload-capabilities';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';
import { RenameWorkloadButton } from './rename-workload-button';
import { WorkloadActionsProvider } from './workload-actions';
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
              'pointer-events-auto absolute top-16 right-2 bottom-2 flex w-3xl flex-col overflow-hidden',
              // Inset 8px inside the main frame's rounded-xl corner, so the
              // radius steps down by the gap and the corners stay concentric.
              'rounded-[calc(var(--radius-xl)-0.5rem)] border border-edge-default bg-surface-panel text-fg-primary shadow-panel outline-none',
              'transition-[translate,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
              'data-[starting-style]:translate-x-[calc(100%+1rem)] data-[starting-style]:opacity-0',
              'data-[ending-style]:translate-x-[calc(100%+1rem)] data-[ending-style]:opacity-0',
            )}
          >
            <WorkloadActionsProvider
              key={`actions-${displayedWorkload.id}`}
              workload={displayedWorkload}
            >
              <WorkloadHeader
                workload={displayedWorkload}
                icon={<WorkloadIconButton fallback={view.icon} />}
                kindLabel={view.kindLabel}
                actions={view.headerActions}
                nameControl={
                  isContainerWorkload(displayedWorkload.type) ? (
                    <RenameWorkloadButton />
                  ) : undefined
                }
                onClose={onClose}
              />

              <Tabs
                key={`tabs-${displayedWorkload.id}`}
                defaultValue={view.tabs[0]?.id}
                className="flex min-h-0 flex-1 flex-col"
              >
                {view.tabs.length > 1 ? (
                  <TabsList
                    aria-label="Service sections"
                    className="relative shrink-0 gap-1 border-edge-default bg-surface-raised px-2.5"
                  >
                    {view.tabs.map(({ id, label, icon: Icon }) => (
                      <TabsTrigger
                        key={id}
                        value={id}
                        className={cn(
                          'mb-0 h-10 gap-2 rounded-md px-2.5 text-sm after:hidden [&_svg]:size-3.5',
                          'focus-visible:ring-2 motion-reduce:transition-none',
                          'data-active:text-fg-primary',
                        )}
                      >
                        <Icon aria-hidden="true" strokeWidth={1.75} />
                        {label}
                      </TabsTrigger>
                    ))}
                    <TabsPrimitive.Indicator
                      aria-hidden="true"
                      className="absolute bottom-0 left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-t-full bg-brand transition-[translate,width] duration-200 ease-out motion-reduce:transition-none"
                    />
                  </TabsList>
                ) : null}

                {view.tabs.map(({ id, content }) => (
                  <TabsContent
                    key={id}
                    value={id}
                    className={cn(
                      'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain bg-surface-panel p-4 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      // Without a tab list, a hairline still closes the header.
                      view.tabs.length <= 1 && 'border-t border-edge-default',
                    )}
                  >
                    {content}
                  </TabsContent>
                ))}
              </Tabs>
            </WorkloadActionsProvider>
          </Dialog.Popup>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  );
};
