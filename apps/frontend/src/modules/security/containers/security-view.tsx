'use client';

import { Fragment, useCallback, useEffect, useId, useState } from 'react';
import {
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type {
  ImageVulnerabilities,
  ProjectSecurity,
  ServiceImageScan,
  VulnerabilityCounts,
  Workload,
} from '@acceleratio/shared';

import { getApiErrorMessage } from '@/api';
import { securityApi } from '@/api/security';
import { cn } from '@/lib/utils';
import { Panel } from '@/modules/observability/components/panel';
import { PanelRow } from '@/modules/observability/components/panel-row';
import { usePolling } from '@/modules/observability/hooks/use-polling';
import { useProject } from '@/modules/projects/providers/project-provider';
import {
  formatPreciseTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Switch } from '@/shared/components/ui/switch';
import { ServiceIcon } from '../components/service-icon';
import {
  SEVERITY_LABEL,
  SEVERITY_TEXT,
  SeverityBadge,
} from '../components/severity-badge';
import { SecurityOverview } from './security-overview';

/** Shown as columns; `unknown` only appears in the lists. */
const COLUMNS = ['critical', 'high', 'medium', 'low'] as const;

const rowKey = (image: ServiceImageScan) =>
  `${image.workload_id}:${image.container}:${image.digest}`;

const total = (counts: VulnerabilityCounts) =>
  Object.values(counts).reduce((sum, count) => sum + count, 0);

const isWaiting = (image: ServiceImageScan) =>
  image.status === 'pending' || image.status === 'scanning';

type SecurityViewProps = {
  /** Loads on first show and polls only while the tab is shown. */
  active: boolean;
};

/**
 * Known vulnerabilities in the images the project's services run, and what to
 * do about them. The API scans each image with Trivy when it first runs and
 * again every day.
 */
export const SecurityView = ({ active }: SecurityViewProps) => {
  const { project, workloads } = useProject();
  const fixableId = useId();
  const [security, setSecurity] = useState<ProjectSecurity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [fixableOnly, setFixableOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        setSecurity(await securityApi.get(project.id, signal));
        setError(null);
      } catch (loadError) {
        if (!signal.aborted) {
          setError(getApiErrorMessage(loadError));
        }
      }
    },
    [project.id],
  );

  usePolling(load, active);

  const scanNow = async () => {
    setIsRequesting(true);
    try {
      setSecurity(await securityApi.scan(project.id));
      setError(null);
    } catch (scanError) {
      setError(getApiErrorMessage(scanError));
    } finally {
      setIsRequesting(false);
    }
  };

  const images = security?.images ?? [];
  const waiting = new Set(images.filter(isWaiting).map((image) => image.digest))
    .size;
  const lastScan = images
    .map((image) => image.scanned_at)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  const workloadById = new Map(workloads.map((item) => [item.id, item]));

  return (
    <div className="flex flex-col gap-3 px-3 pb-10">
      <h2 className="sr-only">Security</h2>
      <div className="pointer-events-none z-20 flex justify-end pt-16 md:sticky md:top-0 md:pt-3">
        <div className="pointer-events-auto flex h-10 items-center gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-float">
          <p
            role="status"
            className="hidden px-2 font-mono text-[11px] whitespace-nowrap text-fg-tertiary tabular-nums md:block"
          >
            {security === null
              ? 'Loading…'
              : waiting > 0
                ? `Scanning ${waiting} ${waiting === 1 ? 'image' : 'images'}`
                : lastScan
                  ? `Scanned ${formatRelativeTime(lastScan)}`
                  : 'Not scanned yet'}
          </p>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            onClick={() => void scanNow()}
            disabled={isRequesting || images.length === 0}
            className="flex h-7.5 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/60 disabled:pointer-events-none disabled:opacity-50"
          >
            <RefreshCw
              aria-hidden="true"
              strokeWidth={1.75}
              className={cn(
                'size-3.5',
                isRequesting && 'animate-spin motion-reduce:animate-none',
              )}
            />
            Scan now
          </button>
        </div>
      </div>

      {error ? (
        <p
          role="status"
          className="self-start rounded-md border border-status-danger/30 bg-surface-raised px-3 py-1.5 text-xs text-status-danger"
        >
          {security ? 'Showing the last good data. ' : ''}
          {error}
        </p>
      ) : null}

      <div aria-busy={security === null} className="flex flex-col gap-4">
        {security === null ? (
          error ? null : (
            <DashboardSkeleton />
          )
        ) : images.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-16 text-center">
            <ShieldCheck
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-5 text-muted-foreground"
            />
            <p className="text-sm font-medium text-foreground">
              Nothing to scan yet
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              The images of running services show up here and are scanned on
              their own.
            </p>
          </div>
        ) : (
          <>
            <SecurityOverview
              projectId={project.id}
              security={security}
              workloads={workloads}
              onChange={setSecurity}
            />

            <PanelRow
              title="All vulnerabilities"
              meta={`${new Set(images.map((image) => image.digest)).size} images`}
            >
              <Panel
                title="By image"
                hint="every finding of every image"
                action={
                  <span className="flex items-center gap-2">
                    <label
                      htmlFor={fixableId}
                      className="text-xs text-fg-secondary"
                    >
                      List only fixable
                    </label>
                    <Switch
                      id={fixableId}
                      checked={fixableOnly}
                      onCheckedChange={setFixableOnly}
                    />
                  </span>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-[13px]">
                    <caption className="sr-only">
                      Vulnerabilities by service image
                    </caption>
                    <thead className="text-left text-[12px] text-fg-tertiary">
                      <tr className="border-b border-edge-subtle">
                        <th scope="col" className="w-8 px-2 py-2.5">
                          <span className="sr-only">Details</span>
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Service
                        </th>
                        {COLUMNS.map((severity) => (
                          <th
                            key={severity}
                            scope="col"
                            className="w-20 px-3 py-2 text-right font-medium"
                          >
                            {SEVERITY_LABEL[severity]}
                          </th>
                        ))}
                        <th
                          scope="col"
                          className="w-20 px-3 py-2 text-right font-medium"
                        >
                          Fixable
                        </th>
                        <th scope="col" className="w-36 px-3 py-2 font-medium">
                          Scan
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge-subtle">
                      {images.map((image) => (
                        <ImageRow
                          key={rowKey(image)}
                          image={image}
                          workload={workloadById.get(image.workload_id)}
                          projectId={project.id}
                          fixableOnly={fixableOnly}
                          expanded={expanded === rowKey(image)}
                          onToggle={() =>
                            setExpanded((current) =>
                              current === rowKey(image) ? null : rowKey(image),
                            )
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </PanelRow>
          </>
        )}
      </div>
    </div>
  );
};

const DashboardSkeleton = () => (
  <div className="flex flex-col gap-4">
    <span className="sr-only">Loading security findings...</span>
    <Skeleton className="h-4 w-32" />
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-38 rounded-xl" />
      ))}
    </div>
    <Skeleton className="h-4 w-28" />
    <div className="grid gap-3 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-62 rounded-xl" />
      ))}
    </div>
    <Skeleton className="h-4 w-28" />
    <Skeleton className="h-80 rounded-xl" />
  </div>
);

const ScanState = ({ image }: { image: ServiceImageScan }) => {
  if (image.status === 'pending') {
    return <span className="text-muted-foreground">Queued</span>;
  }

  if (image.status === 'scanning') {
    return (
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <LoaderCircle
          aria-hidden="true"
          className="size-3.5 animate-spin motion-reduce:animate-none"
        />
        Scanning
      </span>
    );
  }

  if (image.status === 'failed') {
    return (
      <span className="block">
        <span className="font-medium text-destructive">Failed</span>
        {image.status_message ? (
          <span
            title={image.status_message}
            className="block max-w-36 truncate text-xs text-muted-foreground"
          >
            {image.status_message}
          </span>
        ) : null}
      </span>
    );
  }

  return image.scanned_at ? (
    <time
      dateTime={image.scanned_at}
      title={formatPreciseTime(image.scanned_at)}
      className="text-muted-foreground"
    >
      {formatRelativeTime(image.scanned_at)}
    </time>
  ) : null;
};

const ImageRow = ({
  image,
  workload,
  projectId,
  fixableOnly,
  expanded,
  onToggle,
}: {
  image: ServiceImageScan;
  workload: Workload | undefined;
  projectId: string;
  fixableOnly: boolean;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const detailsId = `security-image-${rowKey(image).replace(/[^a-z0-9-]/gi, '-')}`;
  const counts = image.counts;
  const found = counts ? total(counts) : 0;
  const expandable = found > 0;

  return (
    <Fragment>
      <tr
        onClick={expandable ? onToggle : undefined}
        className={cn(
          'align-top transition-colors',
          expandable && 'cursor-pointer hover:bg-surface-muted/40',
        )}
      >
        <td className="w-8 px-2 py-2.5">
          {expandable ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={detailsId}
              aria-label={`Vulnerabilities of ${workload?.name ?? 'service'}`}
              onClick={(event) => {
                // The row's own handler would toggle a second time.
                event.stopPropagation();
                onToggle();
              }}
              className="mx-auto flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  'size-3.5 transition-transform motion-reduce:transition-none',
                  expanded && 'rotate-90',
                )}
              />
            </button>
          ) : null}
        </td>
        <td className="max-w-0 px-3 py-2.5">
          <span className="flex items-center gap-2 text-foreground">
            <ServiceIcon workload={workload} />
            <span className="truncate">{workload?.name ?? 'Service'}</span>
            {image.managed ? (
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] leading-none font-medium text-muted-foreground">
                Updated with Acceleratio
              </span>
            ) : null}
          </span>
          <span
            title={image.image}
            className="mt-0.5 block truncate font-mono text-xs text-muted-foreground"
          >
            {image.image}
          </span>
        </td>
        {counts && found === 0 ? (
          <td
            colSpan={5}
            className="px-3 py-2.5 text-right text-muted-foreground"
          >
            No known vulnerabilities
          </td>
        ) : (
          <>
            {COLUMNS.map((severity) => (
              <CountCell
                key={severity}
                value={counts?.[severity] ?? null}
                className={SEVERITY_TEXT[severity]}
              />
            ))}
            <CountCell value={image.fixable} />
          </>
        )}
        <td className="px-3 py-2.5">
          <ScanState image={image} />
        </td>
      </tr>
      {expanded && expandable ? (
        <tr id={detailsId} className="bg-surface-sunken">
          <td colSpan={8} className="px-4 py-3">
            <VulnerabilityList
              projectId={projectId}
              image={image}
              fixableOnly={fixableOnly}
            />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
};

const CountCell = ({
  value,
  className,
}: {
  value: number | null;
  className?: string;
}) => (
  <td
    className={cn(
      'px-3 py-2.5 text-right tabular-nums',
      value
        ? cn('font-medium text-foreground', className)
        : 'text-muted-foreground/60',
    )}
  >
    {value ?? '—'}
  </td>
);

const VulnerabilityList = ({
  projectId,
  image,
  fixableOnly,
}: {
  projectId: string;
  image: ServiceImageScan;
  fixableOnly: boolean;
}) => {
  const [result, setResult] = useState<ImageVulnerabilities | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    securityApi.vulnerabilities(projectId, image.digest).then(
      (data) => current && setResult(data),
      (loadError: unknown) =>
        current && setError(getApiErrorMessage(loadError)),
    );

    return () => {
      current = false;
    };
    // A rescan replaces the list; refetch when it finished.
  }, [projectId, image.digest, image.scanned_at]);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (!result) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Loading vulnerabilities...</span>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-9 rounded-md" />
        ))}
      </div>
    );
  }

  const shown = fixableOnly
    ? result.vulnerabilities.filter((item) => item.fixed_version)
    : result.vulnerabilities;

  return (
    <div className="flex flex-col gap-2">
      {image.managed ? (
        <p className="text-xs text-muted-foreground">
          Acceleratio chooses this image; a platform update brings the fixes.
        </p>
      ) : null}
      {result.total > result.vulnerabilities.length ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          The {result.vulnerabilities.length} most severe of {result.total}.
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None of these vulnerabilities has a fixed version yet.
        </p>
      ) : (
        <table className="w-full text-[13px]">
          <caption className="sr-only">
            Vulnerabilities of {image.image}
          </caption>
          <thead className="text-left text-[12px] text-muted-foreground">
            <tr>
              <th scope="col" className="w-48 py-1.5 pr-3 font-medium">
                Vulnerability
              </th>
              <th scope="col" className="w-24 py-1.5 pr-3 font-medium">
                Severity
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Package
              </th>
              <th scope="col" className="w-32 py-1.5 pr-3 font-medium">
                Installed
              </th>
              <th scope="col" className="w-40 py-1.5 pr-3 font-medium">
                Fixed in
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((item) => (
              <tr
                key={`${item.id}:${item.package}:${item.installed_version}`}
                className="align-top"
              >
                <td className="py-2 pr-3">
                  <a
                    href={`https://osv.dev/vulnerability/${encodeURIComponent(item.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs text-foreground underline-offset-2 hover:underline"
                  >
                    {item.id}
                    <ExternalLink
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="size-3 text-muted-foreground"
                    />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  {item.exploited ? (
                    <span className="mt-1 block text-[11px] font-medium text-status-danger">
                      Exploited in the wild
                    </span>
                  ) : null}
                  {item.title ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {item.title}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  <SeverityBadge severity={item.severity} />
                </td>
                <td className="py-2 pr-3 font-mono text-xs break-all text-foreground">
                  {item.package}
                </td>
                <td className="py-2 pr-3 font-mono text-xs break-all text-muted-foreground">
                  {item.installed_version}
                </td>
                <td className="py-2 pr-3 font-mono text-xs break-all">
                  {item.fixed_version ? (
                    <span className="text-foreground">
                      {item.fixed_version}
                    </span>
                  ) : (
                    <span className="font-sans text-muted-foreground">
                      No fix yet
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
