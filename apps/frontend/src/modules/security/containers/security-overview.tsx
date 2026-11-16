'use client';

import { useId, useState } from 'react';
import { ShieldCheck, Undo2 } from 'lucide-react';
import type {
  AcceptRiskPayload,
  ProjectSecurity,
  RecommendationLevel,
  SecurityRecommendation,
  ServiceSecurityStatus,
  VulnerabilityCounts,
  Workload,
} from '@acceleratio/shared';

import { getApiErrorMessage } from '@/api';
import { securityApi } from '@/api/security';
import { cn } from '@/lib/utils';
import { DonutPanel } from '@/modules/observability/components/donut-panel';
import { Panel } from '@/modules/observability/components/panel';
import { PanelRow } from '@/modules/observability/components/panel-row';
import { StatPanel } from '@/modules/observability/components/stat-panel';
import { EmptyWell } from '@/modules/observability/components/timeseries-panel';
import { formatCount } from '@/modules/observability/utils/format';
import { useProjectTabs } from '@/modules/projects/providers/project-tabs-provider';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  SERVICE_STATUSES,
  SEVERITIES,
  ServiceStatusPanel,
  SeverityPanel,
  totalOf,
} from '../components/security-panels';
import { ServiceTable, type ServiceRow } from '../components/service-table';

/** Mirrors ACCEPT_RISK_DAYS: the console imports only types from the contract. */
const ACCEPT_RISK_DAYS: readonly AcceptRiskPayload['days'][] = [30, 90, 180];

const LEVEL: Record<RecommendationLevel, { label: string; dot: string }> = {
  urgent: { label: 'Urgent', dot: 'bg-status-danger' },
  recommended: { label: 'Recommended', dot: 'bg-status-warning' },
  optional: { label: 'Optional', dot: 'bg-muted-foreground/60' },
};

const sumCounts = (list: VulnerabilityCounts[]) =>
  Object.fromEntries(
    SEVERITIES.map((severity) => [
      severity,
      list.reduce((sum, counts) => sum + counts[severity], 0),
    ]),
  ) as VulnerabilityCounts;

const fixesOf = (item: SecurityRecommendation) =>
  item.fixes ? totalOf(item.fixes) : 0;

/** `nginx:1.25` from `docker.io/library/nginx:1.25`. */
const shortImage = (image: string | null) =>
  image ? image.slice(image.lastIndexOf('/') + 1) : '';

/** `2 critical, 34 high and 61 medium`, or null when all are zero. */
const counted = (counts: VulnerabilityCounts) => {
  const parts = (['critical', 'high', 'medium', 'low'] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`);

  return parts.length === 0
    ? null
    : parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
};

const closes = (fixes: VulnerabilityCounts | null) => {
  const text = fixes ? counted(fixes) : null;

  return text ? `Closes ${text}` : null;
};

const describe = (
  item: SecurityRecommendation,
  name: string,
): { title: string; detail: string; action: string } => {
  switch (item.kind) {
    case 'dependencies':
      return {
        title: `Update dependencies of ${name}`,
        detail:
          "Packages your code depends on have fixed versions. Raise them in the project's dependency file; the next deploy builds them in.",
        action: 'Open service',
      };
    case 'base_image':
      return {
        title: `Update the base image of ${name}`,
        detail:
          'Packages of the image your Dockerfile starts FROM have fixes. Move FROM to a newer tag, or rebuild if it follows a moving one.',
        action: 'Open service',
      };
    case 'image_update': {
      const update = item.update;
      const current = item.image?.slice(item.image.lastIndexOf(':') + 1) ?? '';

      if (!update) {
        return {
          title: `Look for a newer release of ${shortImage(item.image)}`,
          detail: `Packages in the image ${name} runs have fixed versions. New releases of the image usually include them; move ${name} to one when it is out.`,
          action: 'Edit image',
        };
      }

      const left = update.remaining ? counted(update.remaining) : null;

      return {
        title: `Update ${name} to ${update.tag}`,
        detail: update.remaining
          ? `${update.tag} is the newest release of the same line as ${current}. ${left ? `After the update ${left} remain, waiting for later releases.` : 'Nothing known remains after the update.'}`
          : `${update.tag} is the newest release of the same line as ${current}. It is being scanned to see what it fixes.`,
        action: 'Edit image',
      };
    }
    case 'database_exposed':
      return {
        title: `Database ${name} is open to the whole internet`,
        detail:
          'External access allows every address, so anyone can try passwords on its port. Allow only the networks that need it.',
        action: 'Restrict access',
      };
    case 'moving_tag':
      return {
        title: `${name} follows a moving image tag`,
        detail: `It runs ${item.image ?? 'an image'} without a fixed version, so a redeploy can pull different code. Pin a version or a digest.`,
        action: 'Edit image',
      };
  }
};

/**
 * The Security dashboard: where the project stands, which services need
 * what, the actions to take, and what can be left alone.
 */
export const SecurityOverview = ({
  projectId,
  security,
  workloads,
  onChange,
}: {
  projectId: string;
  security: ProjectSecurity;
  workloads: Workload[];
  /** The tab's data after accepting or restoring a risk. */
  onChange: (next: ProjectSecurity) => void;
}) => {
  const { openService } = useProjectTabs();
  const [error, setError] = useState<string | null>(null);

  const accept = async (payload: AcceptRiskPayload) => {
    try {
      onChange(await securityApi.acceptRisk(projectId, payload));
      setError(null);
    } catch (acceptError) {
      setError(getApiErrorMessage(acceptError));
    }
  };

  const restore = async (recommendationId: string) => {
    try {
      onChange(await securityApi.restoreRisk(projectId, recommendationId));
      setError(null);
    } catch (restoreError) {
      setError(getApiErrorMessage(restoreError));
    }
  };

  const workloadById = new Map(workloads.map((item) => [item.id, item]));
  const nameOf = (id: string) => workloadById.get(id)?.name ?? 'Service';
  const { recommendations, services, accepted } = security;

  // One image run by several services counts once.
  const unique = [
    ...new Map(security.images.map((image) => [image.digest, image])).values(),
  ];
  const scanned = unique.filter((image) => image.counts);
  const queued = unique.length - scanned.length;
  const totals = sumCounts(scanned.flatMap((image) => image.counts ?? []));
  const findings = totalOf(totals);
  const fixable = scanned.reduce((sum, image) => sum + (image.fixable ?? 0), 0);
  const lastScan = unique
    .map((image) => image.scanned_at)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  const urgent = recommendations.filter((item) => item.level === 'urgent');
  const exploited = recommendations.reduce(
    (sum, item) => sum + item.exploited,
    0,
  );
  const publicCount = services.filter((item) => item.public).length;
  const nextBack = accepted
    .map((entry) => entry.expires_at)
    .sort()
    .at(0);

  const statusCounts = Object.fromEntries(
    SERVICE_STATUSES.map(({ status }) => [
      status,
      services.filter((item) => item.status === status).length,
    ]),
  ) as Record<ServiceSecurityStatus, number>;

  const platform = services.filter((item) => item.platform_fixable > 0);
  const platformTotal = platform.reduce(
    (sum, item) => sum + item.platform_fixable,
    0,
  );
  const waiting = services.filter((item) => item.waiting > 0);
  const waitingTotal = waiting.reduce((sum, item) => sum + item.waiting, 0);

  const rows: ServiceRow[] = services.map((service) => {
    const own = [
      ...new Map(
        security.images
          .filter((image) => image.workload_id === service.workload_id)
          .map((image) => [image.digest, image]),
      ).values(),
    ].flatMap((image) => image.counts ?? []);
    const actions = recommendations.filter(
      (item) => item.workload_id === service.workload_id,
    );

    return {
      service,
      workload: workloadById.get(service.workload_id),
      counts: own.length > 0 ? sumCounts(own) : null,
      actions: actions.length,
      urgent: actions.filter((item) => item.level === 'urgent').length,
    };
  });

  return (
    <>
      <PanelRow
        title="Summary"
        panelCount={6}
        className="grid-cols-2 md:grid-cols-3 2xl:grid-cols-6"
      >
        <StatPanel
          title="Urgent actions"
          value={String(urgent.length)}
          caption={`of ${recommendations.length} recommended ${recommendations.length === 1 ? 'action' : 'actions'}`}
          tone={urgent.length > 0 ? 'text-status-danger' : undefined}
        />
        <StatPanel
          title="Exploited in the wild"
          value={String(exploited)}
          caption="known exploited, closed by the actions"
          tone={exploited > 0 ? 'text-status-danger' : undefined}
        />
        <StatPanel
          title="Public services"
          value={String(publicCount)}
          caption={`of ${services.length} reachable from the internet`}
        />
        <StatPanel
          title="Images scanned"
          value={`${scanned.length}/${unique.length}`}
          caption={
            queued > 0
              ? `${queued} in the scan queue`
              : lastScan
                ? `last scan ${formatRelativeTime(lastScan)}`
                : 'none yet'
          }
        />
        <StatPanel
          title="Findings"
          value={String(findings)}
          caption={`${fixable} with a fixed version`}
        />
        <StatPanel
          title="Accepted risks"
          value={String(accepted.length)}
          caption={
            nextBack
              ? `next back ${formatAbsoluteTime(nextBack)}`
              : 'none left alone'
          }
        />
      </PanelRow>

      <PanelRow
        title="Overview"
        panelCount={3}
        className="md:grid-cols-2 xl:grid-cols-3"
      >
        <ServiceStatusPanel counts={statusCounts} />
        <SeverityPanel totals={totals} fixable={fixable} />
        <DonutPanel
          title="Who fixes the findings"
          hint="findings"
          className="md:col-span-2 xl:col-span-1"
          format={formatCount}
          slices={[
            {
              key: 'you',
              label: 'Your actions',
              tone: 'chart-1',
              value: recommendations.reduce(
                (sum, item) => sum + fixesOf(item),
                0,
              ),
            },
            {
              key: 'platform',
              label: 'Acceleratio',
              tone: 'chart-3',
              value: platformTotal,
            },
            {
              key: 'waiting',
              label: 'No fix yet',
              tone: 'other',
              value: waitingTotal,
            },
            {
              key: 'accepted',
              label: 'Accepted',
              tone: 'chart-5',
              value: accepted.reduce(
                (sum, entry) => sum + fixesOf(entry.recommendation),
                0,
              ),
            },
          ]}
        />
      </PanelRow>

      <PanelRow
        title="Services"
        meta={`${services.length} ${services.length === 1 ? 'service' : 'services'}`}
      >
        <Panel title="By service" hint="most pressing first">
          <ServiceTable rows={rows} onOpen={openService} />
        </Panel>
      </PanelRow>

      <PanelRow
        title="Recommended actions"
        meta={`${recommendations.length} ${recommendations.length === 1 ? 'action' : 'actions'}`}
        className="xl:grid-cols-2"
      >
        {error ? (
          <p className="text-sm text-destructive xl:col-span-2">{error}</p>
        ) : null}
        {recommendations.length === 0 ? (
          <Panel title="Nothing to do" className="xl:col-span-2">
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <ShieldCheck
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-5 text-fg-tertiary"
              />
              <p className="text-sm text-fg-secondary">
                No action is needed right now.
              </p>
            </div>
          </Panel>
        ) : (
          recommendations.map((item) => (
            <RecommendationCard
              key={item.id}
              recommendation={item}
              name={nameOf(item.workload_id)}
              isPublic={
                services.find(
                  (service) => service.workload_id === item.workload_id,
                )?.public ?? false
              }
              onOpen={() => openService(item.workload_id)}
              onAccept={(reason, days) =>
                accept({ recommendation_id: item.id, reason, days })
              }
            />
          ))
        )}
      </PanelRow>

      <PanelRow title="Can wait" panelCount={3} className="lg:grid-cols-3">
        <Panel
          title="Handled by Acceleratio"
          hint={`${platformTotal} with a fix`}
          wellClassName="min-h-40"
          footer={
            <p className="text-[11px] text-fg-tertiary">
              The PostgreSQL and static site images, and the base image of
              services built without a Dockerfile, come from Acceleratio. A
              platform update brings the fixes.
            </p>
          }
        >
          {platform.length === 0 ? (
            <EmptyWell label="Nothing waits on a platform update" />
          ) : (
            <CountList
              items={platform.map((item) => ({
                id: item.workload_id,
                name: nameOf(item.workload_id),
                value: `${item.platform_fixable} with a fix`,
              }))}
            />
          )}
        </Panel>

        <Panel
          title="Waiting for fixes"
          hint={`${waitingTotal} without a fix`}
          wellClassName="min-h-40"
          footer={
            <p className="text-[11px] text-fg-tertiary">
              No fixed version exists yet, or no release of the image has it. A
              recommendation appears once one does.
            </p>
          }
        >
          {waiting.length === 0 ? (
            <EmptyWell label="Every finding has a fix" />
          ) : (
            <CountList
              items={waiting.map((item) => ({
                id: item.workload_id,
                name: nameOf(item.workload_id),
                value: `${item.waiting} without a fix`,
              }))}
            />
          )}
        </Panel>

        <Panel
          title="Accepted risks"
          hint={`${accepted.length} left alone`}
          wellClassName="min-h-40"
          footer={
            <p className="text-[11px] text-fg-tertiary">
              Each comes back when it expires, or sooner if it gets worse.
            </p>
          }
        >
          {accepted.length === 0 ? (
            <EmptyWell label="No risk accepted" />
          ) : (
            <ul className="divide-y divide-edge-subtle text-[13px]">
              {accepted.map((entry) => (
                <li
                  key={entry.recommendation.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-fg-primary">
                      {
                        describe(
                          entry.recommendation,
                          nameOf(entry.recommendation.workload_id),
                        ).title
                      }
                    </span>
                    <span className="block text-xs text-fg-tertiary">
                      “{entry.reason}”
                      {entry.accepted_by ? ` · ${entry.accepted_by}` : ''} ·
                      until{' '}
                      <time dateTime={entry.expires_at}>
                        {formatAbsoluteTime(entry.expires_at)}
                      </time>
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void restore(entry.recommendation.id)}
                  >
                    <Undo2 data-icon="inline-start" aria-hidden="true" />
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PanelRow>
    </>
  );
};

const CountList = ({
  items,
}: {
  items: { id: string; name: string; value: string }[];
}) => (
  <ul className="divide-y divide-edge-subtle text-[13px]">
    {items.map((item) => (
      <li
        key={item.id}
        className="flex items-center justify-between gap-3 px-3 py-2"
      >
        <span className="truncate text-fg-primary">{item.name}</span>
        <span className="shrink-0 font-mono text-xs text-fg-secondary tabular-nums">
          {item.value}
        </span>
      </li>
    ))}
  </ul>
);

const Chip = ({ children, tone }: { children: string; tone?: string }) => (
  <span
    className={cn(
      'rounded-full border border-border px-2 py-0.5 text-[11px] leading-none font-medium text-muted-foreground',
      tone,
    )}
  >
    {children}
  </span>
);

const RecommendationCard = ({
  recommendation,
  name,
  isPublic,
  onOpen,
  onAccept,
}: {
  recommendation: SecurityRecommendation;
  name: string;
  isPublic: boolean;
  onOpen: () => void;
  onAccept: (reason: string, days: AcceptRiskPayload['days']) => Promise<void>;
}) => {
  const [accepting, setAccepting] = useState(false);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<AcceptRiskPayload['days']>(90);
  const [saving, setSaving] = useState(false);
  const reasonId = useId();
  const level = LEVEL[recommendation.level];
  const text = describe(recommendation, name);
  const fixes = closes(recommendation.fixes);

  return (
    <article className="rounded-xl border border-edge-default bg-surface-raised px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn('size-1.5 rounded-full', level.dot)}
            />
            {level.label}
            {recommendation.is_new ? (
              <Chip tone="text-foreground">New</Chip>
            ) : null}
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {text.title}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{text.detail}</p>
          {fixes ? (
            <p className="mt-1 text-sm text-foreground">{fixes}</p>
          ) : null}
          {recommendation.packages.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-0.5 font-mono text-xs">
              {recommendation.packages.map((item) => (
                <li key={item.name} className="truncate text-muted-foreground">
                  <span className="text-foreground">{item.name}</span>{' '}
                  {item.installed_version} → {item.fixed_version}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip>{name}</Chip>
            <Chip>{isPublic ? 'Public' : 'Internal only'}</Chip>
            {recommendation.exploited > 0 ? (
              <Chip tone="text-status-danger">
                {`${recommendation.exploited} exploited in the wild`}
              </Chip>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant={recommendation.level === 'urgent' ? 'default' : 'outline'}
            onClick={onOpen}
          >
            {text.action}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={accepting}
            onClick={() => setAccepting((current) => !current)}
          >
            Accept risk
          </Button>
        </div>
      </div>

      {accepting ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) {
              setSaving(true);
              void onAccept(reason.trim(), days).finally(() =>
                setSaving(false),
              );
            }
          }}
        >
          <label htmlFor={reasonId} className="sr-only">
            Why the risk is acceptable
          </label>
          <Input
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why it is acceptable, e.g. the port is firewalled"
            maxLength={500}
            className="h-8 min-w-60 flex-1"
            required
          />
          <div
            role="radiogroup"
            aria-label="For how long"
            className="flex items-center gap-1"
          >
            {ACCEPT_RISK_DAYS.map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                role="radio"
                aria-checked={days === option}
                variant={days === option ? 'secondary' : 'ghost'}
                onClick={() => setDays(option)}
              >
                {option} days
              </Button>
            ))}
          </div>
          <Button type="submit" size="sm" disabled={!reason.trim() || saving}>
            Accept
          </Button>
        </form>
      ) : null}
    </article>
  );
};
