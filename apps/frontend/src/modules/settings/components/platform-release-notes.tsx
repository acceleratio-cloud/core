import { ChevronRight, ExternalLink } from 'lucide-react';

import type { PlatformRelease } from '@acceleratio/shared';
import { formatAbsoluteTime } from '@/modules/workloads/utils/format-time';
import { formatVersion } from '../utils/platform-update';
import { ReleaseNotesMarkdown } from './release-notes-markdown';

type PlatformReleaseNotesProps = {
  /** Newest first. */
  releases: PlatformRelease[];
};

/**
 * What changed in every release between the installed and the latest one.
 * The newest release is open; older ones expand on click.
 */
export const PlatformReleaseNotes = ({
  releases,
}: PlatformReleaseNotesProps) => (
  <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border">
    {releases.map((release, index) => (
      <li key={release.version}>
        <details open={index === 0} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 select-none hover:bg-surface-sunken [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            <span className="min-w-0 flex-1">
              <span className="font-mono text-sm text-foreground tabular-nums">
                {formatVersion(release.version)}
              </span>
              {index === 0 ? (
                <span className="ml-2 rounded-full border border-border px-1.5 py-px text-[11px] font-medium text-muted-foreground">
                  Latest
                </span>
              ) : null}
            </span>
            {release.published_at ? (
              <time
                dateTime={release.published_at}
                className="shrink-0 text-[13px] text-muted-foreground"
              >
                {formatAbsoluteTime(release.published_at)}
              </time>
            ) : null}
          </summary>

          <div className="flex flex-col gap-3 px-4 pt-1 pb-4 pl-10">
            <ReleaseNotesMarkdown markdown={release.notes} />
            {release.url ? (
              <a
                href={release.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1 text-[13px] text-brand-fg underline-offset-4 hover:underline"
              >
                View {formatVersion(release.version)} on GitHub
                <ExternalLink
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="size-3"
                />
              </a>
            ) : null}
          </div>
        </details>
      </li>
    ))}
  </ol>
);
