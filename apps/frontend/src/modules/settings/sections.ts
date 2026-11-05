import type { LucideIcon } from 'lucide-react';
import { HardDrive, SlidersHorizontal, UserRound } from 'lucide-react';

export type SettingsSectionId = 'system' | 'storage' | 'profile';

export type SettingsNavItem = {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
};

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'system';

/** Query parameter that holds the selected section, so a reload keeps it. */
export const SETTINGS_TAB_PARAM = 'tab';

export const SETTINGS_SECTIONS: SettingsNavItem[] = [
  { id: 'system', label: 'System', icon: SlidersHorizontal },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'profile', label: 'Profile', icon: UserRound },
];

export const isSettingsSectionId = (
  value: string,
): value is SettingsSectionId =>
  SETTINGS_SECTIONS.some((section) => section.id === value);

export const settingsSectionHref = (id: SettingsSectionId) =>
  `/settings?${SETTINGS_TAB_PARAM}=${id}`;
