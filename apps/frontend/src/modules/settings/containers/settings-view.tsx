import { IntegrationsCatalog } from '@/modules/integrations/containers/integrations-catalog';
import { SettingsNav } from '../components/settings-nav';
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_SECTIONS,
  type SettingsNavItem,
  type SettingsSectionId,
} from '../sections';
import { ProfileSettings } from './profile-settings';
import { SystemPanel } from './system-panel';

const PANELS = {
  system: SystemPanel,
  integrations: IntegrationsCatalog,
  profile: ProfileSettings,
};

export const SettingsView = ({
  activeId = DEFAULT_SETTINGS_SECTION,
  sections = SETTINGS_SECTIONS,
}: {
  activeId?: SettingsSectionId;
  sections?: SettingsNavItem[];
}) => {
  const ActivePanel = PANELS[activeId];

  return (
    <div className="mt-6 grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <SettingsNav activeId={activeId} sections={sections} />
      <div id="settings-panel" className="min-w-0">
        <ActivePanel />
      </div>
    </div>
  );
};
