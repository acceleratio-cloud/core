'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, Link2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { WorkloadIcon } from '@/modules/workloads/components/workload-icon';
import {
  WORKLOAD_ICON_PACK,
  isIconUrl,
  packIcon,
} from '@/modules/workloads/utils/workload-icon-pack';
import { Button } from '@/shared/components/ui/button';
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/shared/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { useWorkloadActions } from './workload-actions';

const PACK_IDS = WORKLOAD_ICON_PACK.map((icon) => icon.id);
const labelOf = (id: string) => packIcon(id)?.label ?? id;

/** The input holds a URL rather than a search term. */
const looksLikeUrl = (value: string) => /^[a-z][a-z0-9+.-]*:/i.test(value);

/**
 * The icon tile in the panel header. A click opens a picker: a built-in logo
 * or an `https://` image URL with a live preview. The icon is metadata only,
 * so saving never deploys.
 */
export const WorkloadIconButton = ({ fallback }: { fallback: ReactNode }) => {
  const { workload, updateIcon } = useWorkloadActions();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Load result of the preview image, keyed by the URL it belongs to.
  const [preview, setPreview] = useState<{ url: string; ok: boolean } | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The panel's portal ignores pointer events, so the dialog mounts on the body.
  const bodyRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    bodyRef.current = document.body;
  }, []);

  const trimmed = query.trim();
  const urlMode = looksLikeUrl(trimmed);
  // The API also caps the length; its message shows as the submit error.
  const urlError =
    urlMode && !isIconUrl(trimmed) ? 'Use an https:// URL.' : null;
  const previewState =
    !urlMode || urlError
      ? null
      : preview?.url === trimmed
        ? preview.ok
          ? 'loaded'
          : 'failed'
        : 'loading';
  const nextIcon = urlMode ? trimmed : selectedId;
  // Null (an emptied input) is not a choice; "Use default" resets the icon.
  const canSave =
    !isSaving && !urlError && nextIcon !== null && nextIcon !== workload.icon;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSaving) {
      return;
    }

    if (nextOpen) {
      const current = workload.icon;
      const isPack = !!packIcon(current);

      setSelectedId(isPack ? current : null);
      setQuery(current && !isPack ? current : '');
      setPreview(null);
      setSubmitError(null);
    }

    setIsOpen(nextOpen);
  };

  const save = async (icon: string | null) => {
    setIsSaving(true);
    setSubmitError(null);

    try {
      await updateIcon(icon);
      setIsOpen(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        title="Change icon"
        aria-label={`Change icon of ${workload.name}`}
        onClick={() => handleOpenChange(true)}
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-edge-default bg-surface-sunken transition-colors outline-none hover:border-edge-strong focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none [&_svg]:size-5.5"
      >
        <WorkloadIcon
          icon={workload.icon}
          fallback={fallback}
          className="size-5.5"
        />
      </button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          container={bodyRef}
          showCloseButton={!isSaving}
          className="sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>Service icon</DialogTitle>
            <DialogDescription>
              Pick a logo or paste an https:// link to an image. The icon only
              changes how the service looks here; it does not redeploy.
            </DialogDescription>
          </DialogHeader>

          <Combobox
            inline
            open={isOpen}
            items={PACK_IDS}
            itemToStringLabel={labelOf}
            value={selectedId}
            onValueChange={(value) => {
              setSelectedId(value);
              setQuery('');
            }}
            inputValue={query}
            onInputValueChange={(value, details) => {
              // Picking a logo would fill the input with its label and filter
              // the list down to it; keep the search as typed instead.
              if (details.reason !== 'item-press') {
                setQuery(value);
              }
            }}
          >
            <ComboboxInput
              autoFocus
              showTrigger={false}
              placeholder="Search logos or paste an https:// URL"
              aria-invalid={!!urlError || undefined}
              className="mt-4 w-full"
            />

            {urlMode ? (
              <div className="mt-3 flex items-center gap-3 rounded-lg border border-edge-default bg-surface-sunken p-3">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-edge-default bg-surface-panel">
                  {previewState ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote user URL, not optimizable
                    <img
                      key={trimmed}
                      src={trimmed}
                      alt=""
                      referrerPolicy="no-referrer"
                      onLoad={() => setPreview({ url: trimmed, ok: true })}
                      onError={() => setPreview({ url: trimmed, ok: false })}
                      className={cn(
                        'size-8 object-contain',
                        previewState === 'failed' && 'hidden',
                      )}
                    />
                  ) : null}
                  {previewState !== 'loaded' ? (
                    <Link2
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="size-5 text-fg-tertiary"
                    />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1 text-sm" aria-live="polite">
                  {urlError ? (
                    <p className="text-status-danger">{urlError}</p>
                  ) : previewState === 'failed' ? (
                    <p className="flex items-start gap-1.5 text-status-warning">
                      <CircleAlert
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="mt-0.5 size-4 shrink-0"
                      />
                      This URL did not load as an image. If it stays
                      unreachable, the default icon shows instead.
                    </p>
                  ) : previewState === 'loaded' ? (
                    <p className="text-fg-secondary">
                      Preview of the remote icon.
                    </p>
                  ) : (
                    <p className="text-fg-tertiary">Loading preview…</p>
                  )}
                  <p
                    title={trimmed}
                    className="mt-0.5 truncate font-mono text-xs text-fg-tertiary"
                  >
                    {trimmed}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* The shadcn empty state shows through the popup's group class, which
                    an inline list has none of; it renders children only when empty. */}
                <ComboboxEmpty className="mt-2 flex empty:hidden">
                  No logo matches.
                </ComboboxEmpty>
                <ComboboxList className="mt-2 grid max-h-80 grid-cols-2 gap-0.5 rounded-lg border border-edge-default bg-surface-sunken p-1 data-empty:hidden">
                  {(id: string) => {
                    const icon = packIcon(id);

                    return icon ? (
                      <ComboboxItem
                        key={id}
                        value={id}
                        className="h-9 gap-2.5 px-2"
                      >
                        <icon.Svg
                          aria-hidden="true"
                          {...(icon.mono && { variant: 'mono' })}
                          className="size-4.5"
                        />
                        {icon.label}
                      </ComboboxItem>
                    ) : null;
                  }}
                </ComboboxList>
              </>
            )}
          </Combobox>

          {submitError ? (
            <p role="alert" className="mt-3 text-sm text-status-danger">
              {submitError}
            </p>
          ) : null}

          <DialogFooter className="mt-5">
            {workload.icon ? (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto"
                disabled={isSaving}
                onClick={() => save(null)}
              >
                Use default
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              disabled={isSaving}
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={isSaving}
              disabled={!canSave}
              onClick={() => save(nextIcon)}
            >
              {isSaving ? 'Saving' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
