import { SettingsNav } from '../components/settings-nav';
import { DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from '../sections';
import { ProfileSettings } from './profile-settings';
import { StoragePanel } from './storage-panel';
import { SystemSettings } from './system-settings';

const PANELS = {
  system: SystemSettings,
  storage: StoragePanel,
  profile: ProfileSettings,
};

export const SettingsView = ({
  activeId = DEFAULT_SETTINGS_SECTION,
}: {
  activeId?: SettingsSectionId;
}) => {
  const ActivePanel = PANELS[activeId];

  return (
    <div>
      <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
        Settings
      </h1>
      <p className="mt-2.5 text-sm text-muted-foreground">
        Manage storage, your profile, and the control plane.
      </p>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SettingsNav activeId={activeId} />
        <div id="settings-panel" className="min-w-0">
          <ActivePanel />
        </div>
      </div>
    </div>
  );
};
