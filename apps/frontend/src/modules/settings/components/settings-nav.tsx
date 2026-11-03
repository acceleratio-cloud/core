"use client"

import { cn } from "@/lib/utils"
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "../sections"

type SettingsNavProps = {
  activeId: SettingsSectionId
  onSelect: (id: SettingsSectionId) => void
}

export const SettingsNav = ({ activeId, onSelect }: SettingsNavProps) => {
  return (
    <nav
      aria-label="Settings"
      className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface-raised p-1.5 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible"
    >
      {SETTINGS_SECTIONS.map((section) => {
        const Icon = section.icon
        const active = section.id === activeId

        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onSelect(section.id)}
            aria-current={active ? "page" : undefined}
            aria-controls="settings-panel"
            className={cn(
              "flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            <Icon
              aria-hidden="true"
              strokeWidth={1.75}
              className={cn(
                "size-3.5 shrink-0",
                active ? "text-foreground" : "text-muted-foreground"
              )}
            />
            {section.label}
          </button>
        )
      })}
    </nav>
  )
}
