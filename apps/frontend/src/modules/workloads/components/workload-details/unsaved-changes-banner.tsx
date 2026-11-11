import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';

/**
 * Sticky warning bar (an opaque tint, so content scrolls under it) pinned to the top of a tab's scroll area while its form has
 * unsaved changes. It cancels the tab panel's 16px padding to sit flush under
 * the tab list, and must be inside a `<form>` for Save to submit it.
 */
export const UnsavedChangesBanner = ({
  message,
  isSaving,
  isLocked,
  onDiscard,
  className,
}: {
  /** Replaces the default copy, e.g. with a save error. */
  message?: string | null;
  isSaving: boolean;
  isLocked: boolean;
  onDiscard: () => void;
  className?: string;
}) => (
  <div
    role="status"
    className={cn(
      'sticky -top-4 z-10 -mx-4 -mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-status-warning/35 bg-[color-mix(in_oklch,var(--status-warning)_12%,var(--surface-raised))] px-4 py-2 text-status-warning',
      className,
    )}
  >
    <p className="min-w-0 flex-1 text-sm font-medium">
      {message ?? 'You have unsaved changes.'}
    </p>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isSaving}
      onClick={onDiscard}
    >
      Discard
    </Button>
    <Button type="submit" size="sm" loading={isSaving} disabled={isLocked}>
      {isSaving ? 'Saving' : 'Save changes'}
    </Button>
  </div>
);
