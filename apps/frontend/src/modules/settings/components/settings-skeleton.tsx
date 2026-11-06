import { Skeleton } from '@/shared/components/ui/skeleton';

/** The settings layout while the selected section loads. */
export const SettingsSkeleton = () => (
  <div
    aria-busy="true"
    className="mt-6 grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]"
  >
    <span className="sr-only">Loading settings</span>
    <div className="flex gap-1 rounded-lg border border-border bg-surface-raised p-1.5 lg:flex-col">
      <Skeleton className="h-8 w-24 lg:w-full" />
      <Skeleton className="h-8 w-24 lg:w-full" />
      <Skeleton className="h-8 w-24 lg:w-full" />
    </div>
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-6">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-32 w-full" />
    </div>
  </div>
);
