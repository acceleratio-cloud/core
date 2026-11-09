'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { KeyRound, TriangleAlert } from 'lucide-react';

import type {
  PostgresConfig,
  PostgresExposure,
  Workload,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { postgresApi } from '@/api/workloads/postgres';
import { cn } from '@/lib/utils';
import { useProject } from '@/modules/projects/providers/project-provider';
import { DetailSection } from '@/modules/workloads/components/workload-details/detail-primitives';
import {
  PasswordValue,
  Segmented,
  usePostgresPassword,
} from '@/modules/workloads/components/workload-details/postgres-overview';
import { useStorageProfiles } from '@/modules/workloads/hooks/use-storage-profiles';
import {
  DEFAULT_CPU_MAX,
  DEFAULT_RAM_MAX,
  formatCpu,
  formatMemory,
} from '@/modules/workloads/utils/workload-config';
import { CopyButton } from '@/shared/components/copy-button';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Slider } from '@/shared/components/ui/slider';
import { Switch } from '@/shared/components/ui/switch';
import { Textarea } from '@/shared/components/ui/textarea';
import { SettingRow, SliderScale } from './edit-docker-workload-config';

const EVERYONE = '0.0.0.0/0';
const CPU_RANGE = { min: 0.25, max: 8, step: 0.25 };
const RAM_RANGE = { min: 256, max: 16384, step: 256 };
/** The API's largest volume, in GiB. */
const DISK_MAX_GB = 100;

/** The panel's portal ignores pointer events; dialogs mount on the body. */
const useBody = () => {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    ref.current = document.body;
  }, []);

  return ref;
};

const Divided = ({ children }: { children: React.ReactNode }) => (
  <div className="divide-y divide-edge-subtle">{children}</div>
);

const ReadOnly = ({ children }: { children: React.ReactNode }) => (
  <p className="flex h-8 items-center font-mono text-[13px] text-fg-primary tabular-nums">
    {children}
  </p>
);

const Footer = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-12 flex-wrap items-center justify-end gap-2 border-t border-edge-subtle bg-surface-panel/60 px-3 py-2">
    {children}
  </div>
);

const ErrorText = ({ children }: { children: React.ReactNode }) => (
  <p role="alert" className="mr-auto text-xs text-status-danger">
    {children}
  </p>
);

/** One limit: a switch for "limited" and, while on, a slider for its value. */
const LimitRow = ({
  label,
  hint,
  limited,
  value,
  range,
  format,
  onLimited,
  onValue,
}: {
  label: string;
  hint: string;
  limited: boolean;
  value: number;
  range: { min: number; max: number; step: number };
  format: (value: number) => string;
  onLimited: (limited: boolean) => void;
  onValue: (value: number) => void;
}) => {
  const labelId = useId();
  const switchId = useId();
  const min = Math.min(range.min, value);
  const max = Math.max(range.max, value);

  return (
    <SettingRow label={label} labelId={labelId} hint={hint}>
      <div className="flex h-8 items-center gap-3">
        <label
          htmlFor={switchId}
          className={cn(
            'flex-1 font-mono text-[13px] tabular-nums',
            limited ? 'text-fg-primary' : 'text-fg-tertiary',
          )}
        >
          {limited ? format(value) : 'Unlimited'}
        </label>
        <Switch
          id={switchId}
          aria-label={`Limit ${label.toLowerCase()}`}
          checked={limited}
          onCheckedChange={onLimited}
        />
      </div>
      {limited ? (
        <div className="pt-2">
          <Slider
            aria-labelledby={labelId}
            value={value}
            min={min}
            max={max}
            step={range.step}
            onValueChange={(next) => {
              const number = Array.isArray(next) ? next[0] : next;

              onValue(Math.round(number * 1000) / 1000);
            }}
          />
          <SliderScale min={format(min)} max={format(max)} />
        </div>
      ) : null}
    </SettingRow>
  );
};

/**
 * The disk: a slider from its current size up, since a volume cannot
 * shrink. Profiles that cannot grow volumes show the size only.
 */
const DiskRow = ({
  current,
  value,
  profileName,
  canGrow,
  checking,
  onValue,
}: {
  current: number;
  value: number;
  profileName: string | null;
  canGrow: boolean;
  checking: boolean;
  onValue: (value: number) => void;
}) => {
  const labelId = useId();
  const format = (size: number) => `${size} GiB`;

  return (
    <SettingRow
      label="Disk"
      labelId={labelId}
      hint={
        checking
          ? 'Checking the profile…'
          : canGrow
            ? 'Grows, never shrinks'
            : 'Profile cannot grow it'
      }
    >
      <p className="flex h-8 items-center gap-2 font-mono text-[13px] text-fg-primary tabular-nums">
        {format(value)}
        {value > current ? (
          <span className="font-sans text-xs text-fg-tertiary">
            from {format(current)}
          </span>
        ) : profileName ? (
          <span className="font-sans text-xs text-fg-tertiary">
            {profileName}
          </span>
        ) : null}
      </p>
      {canGrow ? (
        <div className="pt-2">
          <Slider
            aria-labelledby={labelId}
            value={value}
            min={current}
            max={DISK_MAX_GB}
            step={1}
            onValueChange={(next) =>
              onValue(Array.isArray(next) ? next[0] : next)
            }
          />
          <SliderScale min={format(current)} max={format(DISK_MAX_GB)} />
        </div>
      ) : null}
    </SettingRow>
  );
};

/**
 * What the database runs on. The version and disk are fixed at creation;
 * CPU and memory change here, and saving restarts the instance.
 */
export const PostgresResourcesSection = ({
  workload,
}: {
  workload: Workload;
}) => {
  const { replaceWorkload } = useProject();
  const profiles = useStorageProfiles();
  const config = workload.active_version?.config as PostgresConfig | undefined;
  const initial = {
    cpuLimited: config?.cpu_max !== null,
    cpu: config?.cpu_max ?? DEFAULT_CPU_MAX,
    ramLimited: config?.ram_max !== null,
    ram: config?.ram_max ?? DEFAULT_RAM_MAX,
    size: config?.size_gb ?? DISK_MAX_GB,
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  if (!config) {
    return null;
  }

  const profile =
    profiles.status !== 'ready'
      ? null
      : (profiles.profiles.find((item) =>
          config.storage_class_id === null
            ? item.kind === 'platform'
            : item.id === config.storage_class_id,
        ) ?? null);
  const canGrow =
    Boolean(profile?.allow_volume_expansion) && config.size_gb < DISK_MAX_GB;
  const restarts =
    form.cpuLimited !== initial.cpuLimited ||
    form.cpu !== initial.cpu ||
    form.ramLimited !== initial.ramLimited ||
    form.ram !== initial.ram;

  const save = async () => {
    setSaving(true);
    setError(null);

    try {
      replaceWorkload(
        await workloadsApi.update(workload.project_id, workload.id, {
          config: {
            ...config,
            size_gb: form.size,
            cpu_max: form.cpuLimited ? form.cpu : null,
            ram_max: form.ramLimited ? form.ram : null,
          },
        }),
      );
    } catch (saveError) {
      setError(getApiErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailSection
      title="Resources"
      description="The version is set when the database is created; the disk can only grow."
    >
      <Divided>
        <SettingRow label="Version" hint="Fixed">
          <ReadOnly>PostgreSQL {config.postgres_version}</ReadOnly>
        </SettingRow>
        <DiskRow
          current={config.size_gb}
          value={form.size}
          profileName={profile?.name ?? null}
          canGrow={canGrow}
          checking={profiles.status === 'loading'}
          onValue={(size) => setForm({ ...form, size })}
        />
        <LimitRow
          label="CPU"
          hint="Most a query can use"
          limited={form.cpuLimited}
          value={form.cpu}
          range={CPU_RANGE}
          format={formatCpu}
          onLimited={(cpuLimited) => setForm({ ...form, cpuLimited })}
          onValue={(cpu) => setForm({ ...form, cpu })}
        />
        <LimitRow
          label="Memory"
          hint="Caches and sessions"
          limited={form.ramLimited}
          value={form.ram}
          range={RAM_RANGE}
          format={formatMemory}
          onLimited={(ramLimited) => setForm({ ...form, ramLimited })}
          onValue={(ram) => setForm({ ...form, ram })}
        />
      </Divided>
      {dirty || error ? (
        <Footer>
          {error ? (
            <ErrorText>{error}</ErrorText>
          ) : (
            <p className="mr-auto text-xs text-fg-tertiary">
              {restarts
                ? 'Saving restarts the database for a few seconds.'
                : 'The disk grows in place; the database keeps running.'}
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              setForm(initial);
              setError(null);
            }}
          >
            Discard
          </Button>
          <Button
            type="button"
            size="sm"
            loading={saving}
            disabled={!dirty}
            onClick={() => void save()}
          >
            {restarts ? 'Save and restart' : 'Grow disk'}
          </Button>
        </Footer>
      ) : null}
    </DetailSection>
  );
};

type Scope = 'listed' | 'everyone';

const ExposureForm = ({
  workload,
  current,
  onSaved,
  onCancel,
}: {
  workload: Workload;
  current: PostgresExposure;
  onSaved: (exposure: PostgresExposure) => void;
  onCancel: () => void;
}) => {
  const networksId = useId();
  const portId = useId();
  const [scope, setScope] = useState<Scope>(
    current.allowed_cidrs.includes(EVERYONE) ? 'everyone' : 'listed',
  );
  const [networks, setNetworks] = useState(
    current.allowed_cidrs.filter((cidr) => cidr !== EVERYONE).join('\n'),
  );
  const [port, setPort] = useState(
    current.node_port === null ? '' : String(current.node_port),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const listed = networks
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (scope === 'listed' && listed.length === 0) {
      setError('Add at least one address or network, or allow anyone.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      onSaved(
        await postgresApi.updateExposure(workload.project_id, workload.id, {
          enabled: true,
          allowed_cidrs: scope === 'everyone' ? [EVERYONE] : listed,
          node_port: port.trim() === '' ? null : Number(port),
        }),
      );
    } catch (saveError) {
      setError(getApiErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Divided>
        <SettingRow label="Who can connect" hint="By source address">
          <div className="flex flex-col gap-2">
            <Segmented<Scope>
              label="Who can connect"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'listed', label: 'Listed networks' },
                { value: 'everyone', label: 'Anyone' },
              ]}
            />
            {scope === 'listed' ? (
              <>
                <label htmlFor={networksId} className="sr-only">
                  Addresses or networks, one per line
                </label>
                <Textarea
                  id={networksId}
                  placeholder={'203.0.113.7\n198.51.100.0/24'}
                  value={networks}
                  onChange={(event) => setNetworks(event.target.value)}
                  rows={3}
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-fg-tertiary">
                  One address or network per line.
                </p>
              </>
            ) : (
              <p className="flex gap-2 rounded-md bg-status-warning/10 px-2.5 py-2 text-xs leading-5 text-fg-primary">
                <TriangleAlert
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="mt-0.5 size-3.5 shrink-0 text-status-warning"
                />
                Anyone who finds the address can try passwords against this
                database.
              </p>
            )}
          </div>
        </SettingRow>
        <SettingRow label="Port" htmlFor={portId} hint="30000–32767">
          <Input
            id={portId}
            type="number"
            inputMode="numeric"
            min={30000}
            max={32767}
            placeholder="Pick automatically"
            value={port}
            onChange={(event) => setPort(event.target.value)}
            className="h-8 font-mono"
          />
        </SettingRow>
      </Divided>
      <Footer>
        {error ? (
          <ErrorText>{error}</ErrorText>
        ) : (
          <p className="mr-auto text-xs text-fg-tertiary">
            Clients outside must use TLS (sslmode=require).
          </p>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          loading={saving}
          onClick={() => void save()}
        >
          {current.enabled ? 'Save access' : 'Open port'}
        </Button>
      </Footer>
    </>
  );
};

/** Opens the database port outside the cluster; closed by default. */
export const PostgresExternalAccessSection = ({
  workload,
}: {
  workload: Workload;
}) => {
  const switchId = useId();
  const [exposure, setExposure] = useState<PostgresExposure | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    postgresApi
      .exposure(workload.project_id, workload.id)
      .then((data) => active && setExposure(data))
      .catch(
        (fetchError) => active && setLoadError(getApiErrorMessage(fetchError)),
      );

    return () => {
      active = false;
    };
    // The address follows the primary, which can move on restarts.
  }, [workload.project_id, workload.id, workload.status]);

  const close = async () => {
    setClosing(true);
    setError(null);

    try {
      setExposure(
        await postgresApi.updateExposure(workload.project_id, workload.id, {
          enabled: false,
        }),
      );
      setEditing(false);
    } catch (closeError) {
      setError(getApiErrorMessage(closeError));
    } finally {
      setClosing(false);
    }
  };

  const open = exposure?.enabled ?? false;
  const address =
    open && exposure?.host && exposure.node_port
      ? `${exposure.host}:${exposure.node_port}`
      : null;
  const everyone = exposure?.allowed_cidrs.includes(EVERYONE) ?? false;
  const rules = exposure?.allowed_cidrs.length ?? 0;

  return (
    <DetailSection title="External access">
      <SettingRow
        label="Public port"
        htmlFor={switchId}
        hint={open ? (everyone ? 'Anyone' : 'Listed networks') : 'Project only'}
      >
        <div className="flex h-8 items-center gap-3">
          <span
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[13px] tabular-nums',
              open ? 'text-fg-primary' : 'text-fg-tertiary',
            )}
          >
            {exposure === null ? (
              <span className="font-sans text-xs">
                {loadError ?? 'Loading…'}
              </span>
            ) : editing && !open ? (
              <span className="font-sans text-xs">
                Choose who can connect below
              </span>
            ) : open ? (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    everyone ? 'bg-status-warning' : 'bg-status-success',
                  )}
                />
                <span className="truncate">
                  {address ?? 'Waiting for the database'}
                </span>
                {address ? (
                  <CopyButton
                    value={address}
                    label="address"
                    className="text-fg-tertiary"
                  />
                ) : null}
              </>
            ) : (
              'Closed'
            )}
          </span>
          <Switch
            id={switchId}
            aria-label="Public port"
            checked={open || editing}
            disabled={exposure === null || closing}
            onCheckedChange={(checked) => {
              if (checked) {
                setEditing(true);
              } else if (open) {
                void close();
              } else {
                setEditing(false);
              }
            }}
          />
        </div>
      </SettingRow>

      {exposure !== null && editing ? (
        <div className="border-t border-edge-subtle">
          <ExposureForm
            workload={workload}
            current={exposure}
            onCancel={() => setEditing(false)}
            onSaved={(next) => {
              setExposure(next);
              setEditing(false);
            }}
          />
        </div>
      ) : open && exposure ? (
        <div className="border-t border-edge-subtle">
          <SettingRow
            label="Allowed"
            hint={`${rules} ${rules === 1 ? 'network' : 'networks'}`}
          >
            <div className="flex min-h-8 flex-wrap items-center gap-1.5">
              {exposure.allowed_cidrs.map((cidr) => (
                <span
                  key={cidr}
                  className="rounded-sm border border-edge-default bg-surface-sunken px-1.5 font-mono text-xs leading-5 text-fg-secondary"
                >
                  {cidr === EVERYONE ? 'anyone' : cidr}
                </span>
              ))}
            </div>
          </SettingRow>
          <Footer>
            {error ? (
              <ErrorText>{error}</ErrorText>
            ) : (
              <p className="mr-auto text-xs text-fg-tertiary">
                Only TLS connections are accepted from outside.
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
            >
              Edit access
            </Button>
          </Footer>
        </div>
      ) : error ? (
        <Footer>
          <ErrorText>{error}</ErrorText>
        </Footer>
      ) : null}
    </DetailSection>
  );
};

/**
 * Replaces the password after a confirmation and shows the new one once.
 * The database applies it within seconds and keeps its data.
 */
export const PostgresCredentialsSection = ({
  workload,
}: {
  workload: Workload;
}) => {
  const body = useBody();
  const passwordState = usePostgresPassword(workload);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (busy) {
      return;
    }

    setOpen(next);

    if (!next) {
      // The password leaves memory with the dialog.
      setPassword(null);
      setError(null);
    }
  };

  const rotate = async () => {
    setBusy(true);
    setError(null);

    try {
      const credentials = await postgresApi.rotateCredentials(
        workload.project_id,
        workload.id,
      );

      setPassword(credentials.password);

      // A password shown before the change is no longer the right one.
      if (passwordState.password !== null) {
        passwordState.toggle();
      }
    } catch (rotateError) {
      setError(getApiErrorMessage(rotateError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DetailSection title="Credentials">
        <Divided>
          <SettingRow label="User" hint="Owns the app database">
            <ReadOnly>{workload.postgres?.username}</ReadOnly>
          </SettingRow>
          <SettingRow label="Password" hint="Shown on request">
            <div className="flex h-8 items-center gap-1">
              <PasswordValue state={passwordState} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(true)}
              >
                <KeyRound
                  data-icon="inline-start"
                  aria-hidden="true"
                  strokeWidth={1.75}
                />
                Regenerate
              </Button>
            </div>
          </SettingRow>
        </Divided>
      </DetailSection>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent container={body} showCloseButton={!busy}>
          {password === null ? (
            <>
              <DialogHeader>
                <DialogTitle>Regenerate password</DialogTitle>
                <DialogDescription>
                  {workload.name} gets a new password within seconds. Services
                  and clients that use the current one lose access until you
                  give them the new password. Data is not touched.
                </DialogDescription>
              </DialogHeader>
              {error ? (
                <p role="alert" className="text-xs text-status-danger">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => handleOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  loading={busy}
                  onClick={() => void rotate()}
                >
                  Regenerate password
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>New password</DialogTitle>
                <DialogDescription>
                  Copy it now, or show it later with the eye button in
                  Credentials.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 flex items-center gap-2 rounded-md border border-edge-default bg-surface-sunken px-3 py-2">
                <code className="min-w-0 flex-1 font-mono text-sm break-all text-fg-primary">
                  {password}
                </code>
                <CopyButton value={password} label="password" />
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
