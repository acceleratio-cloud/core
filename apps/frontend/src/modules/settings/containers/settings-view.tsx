'use client';

import { useState } from 'react';

import { SettingsNav } from '../components/settings-nav';
import type { SettingsSectionId } from '../sections';
import { AiProviderSettings } from './ai-provider-settings';
import { CloudProvidersSettings } from './cloud-providers-settings';
import { ProfileSettings } from './profile-settings';
import { StoragePanel } from './storage-panel';
import { SystemSettings } from './system-settings';

const PANELS = {
  ai: AiProviderSettings,
  cloud: CloudProvidersSettings,
  storage: StoragePanel,
  profile: ProfileSettings,
  system: SystemSettings,
};

export const SettingsView = () => {
  const [activeId, setActiveId] = useState<SettingsSectionId>('ai');
  const ActivePanel = PANELS[activeId];

  return (
    <div>
      <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
        Settings
      </h1>
      <p className="mt-2.5 text-sm text-muted-foreground">
        Manage provider credentials, storage, your profile, and the control
        plane.
      </p>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNav activeId={activeId} onSelect={setActiveId} />
        <div id="settings-panel" className="min-w-0">
          <ActivePanel />
        </div>
      </div>
    </div>
  );
};
