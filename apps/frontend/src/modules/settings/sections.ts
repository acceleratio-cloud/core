import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  Cloud,
  HardDrive,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react';

export type SettingsSectionId =
  'ai' | 'cloud' | 'storage' | 'profile' | 'system';

export type SettingsNavItem = {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
};

export const SETTINGS_SECTIONS: SettingsNavItem[] = [
  { id: 'ai', label: 'AI provider', icon: Bot },
  { id: 'cloud', label: 'Cloud providers', icon: Cloud },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'system', label: 'System', icon: SlidersHorizontal },
];

export const isSettingsSectionId = (
  value: string,
): value is SettingsSectionId =>
  SETTINGS_SECTIONS.some((section) => section.id === value);
