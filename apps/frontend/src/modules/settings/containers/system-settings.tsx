'use client';

import { useState, type FormEvent } from 'react';

import { Field, FieldGroup, FieldLabel } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { SettingsActions } from '../components/settings-actions';
import { SettingsSection } from '../components/settings-section';

const UPDATE_CHANNELS = [
  { value: 'stable', label: 'Stable' },
  { value: 'edge', label: 'Edge' },
];

export const SystemSettings = () => {
  const [saved, setSaved] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(true);
  };

  return (
    <SettingsSection
      id="system"
      title="System"
      description="Identify the control plane and choose how updates are delivered."
    >
      <form onSubmit={handleSubmit} onChange={() => setSaved(false)}>
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="system-cluster-name">
                Cluster name
              </FieldLabel>
              <Input
                id="system-cluster-name"
                name="cluster_name"
                defaultValue="prod-cluster"
                autoComplete="off"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="system-update-channel">
                Update channel
              </FieldLabel>
              <Select
                name="update_channel"
                defaultValue="stable"
                items={UPDATE_CHANNELS}
              >
                <SelectTrigger id="system-update-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UPDATE_CHANNELS.map((channel) => (
                    <SelectItem key={channel.value} value={channel.value}>
                      {channel.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="system-control-plane-url">
              Control plane URL
            </FieldLabel>
            <Input
              id="system-control-plane-url"
              name="control_plane_url"
              defaultValue="https://console.acceleratio.local"
              autoComplete="url"
            />
          </Field>
        </FieldGroup>

        <SettingsActions saved={saved} />
      </form>
    </SettingsSection>
  );
};
