import type { LucideIcon } from "lucide-react"
import { Bot, Cloud, SlidersHorizontal, UserRound } from "lucide-react"

export type SettingsSectionId = "ai" | "cloud" | "profile" | "system"

export type SettingsNavItem = {
  id: SettingsSectionId
  label: string
  icon: LucideIcon
}

export const SETTINGS_SECTIONS: SettingsNavItem[] = [
  { id: "ai", label: "AI provider", icon: Bot },
  { id: "cloud", label: "Cloud providers", icon: Cloud },
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "system", label: "System", icon: SlidersHorizontal },
]
