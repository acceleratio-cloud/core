"use client"

import { useEffect, useState } from "react"

import { getApiErrorMessage } from "@/api"
import { systemApi } from "@/api/system"
import type {
  SystemComponentState,
  SystemComponentStatus,
} from "@acceleratio/shared"
import { Button } from "@/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import { cn } from "@/lib/utils"

const REFRESH_MS = 30_000

const STATE: Record<SystemComponentState, { label: string; dot: string }> = {
  operational: { label: "Operational", dot: "text-status-success" },
  degraded: { label: "Degraded", dot: "text-status-warning" },
  down: { label: "Down", dot: "text-status-danger" },
  unknown: { label: "Unknown", dot: "text-muted-foreground" },
}

/** One line for the whole platform, from the worst component state. */
const summarize = (
  components: SystemComponentStatus[] | null,
  error: string | null,
): { label: string; dot: string } => {
  if (!components) {
    return {
      label: error ? "Status unavailable" : "System status",
      dot: "text-muted-foreground",
    }
  }
  if (components.some((component) => component.state === "down")) {
    return { label: "Major outage", dot: STATE.down.dot }
  }
  if (components.some((component) => component.state === "degraded")) {
    return { label: "Partially degraded", dot: STATE.degraded.dot }
  }
  if (components.some((component) => component.state === "unknown")) {
    return { label: "Status unknown", dot: STATE.unknown.dot }
  }
  return { label: "Operational", dot: STATE.operational.dot }
}

/** Component states, polled every 30 seconds. */
export const useSystemStatus = () => {
  const [components, setComponents] = useState<SystemComponentStatus[] | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const load = () =>
      systemApi
        .getStatus()
        .then((items) => {
          if (active) {
            setComponents(items)
            setError(null)
          }
        })
        .catch((requestError) => {
          if (active) {
            setError(getApiErrorMessage(requestError))
          }
        })

    void load()
    const timer = setInterval(load, REFRESH_MS)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  return { components, error, summary: summarize(components, error) }
}

/** Header button showing platform health; opens every component's state. */
export const SystemStatusButton = () => {
  const { components, error, summary } = useSystemStatus()
  const [open, setOpen] = useState(false)

  // Nothing until the first answer, so the label never flips on load.
  if (!components) {
    return null
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="rounded-full text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden="true" className={cn("status-dot", summary.dot)} />
        <span className="hidden xl:inline">{summary.label}</span>
        <span className="sr-only xl:hidden">{summary.label}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>System status</DialogTitle>
            <DialogDescription>
              {summary.label}. Refreshed every 30 seconds.
            </DialogDescription>
          </DialogHeader>

          <SystemStatusList
            components={components}
            error={error}
            className="mt-4 [&_ul]:max-h-[60vh]"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Every component's state; an error keeps the last answer, dimmed. `compact`
 * lays the components out as a grid of tiles instead of full-width rows.
 */
export const SystemStatusList = ({
  components,
  error,
  className,
  compact = false,
}: {
  components: SystemComponentStatus[] | null
  error: string | null
  className?: string
  compact?: boolean
}) => (
  <div className={className}>
    {error ? (
      <p role="status" className="mb-4 text-sm text-destructive">
        {components ? `Status may be out of date: ${error}` : error}
      </p>
    ) : null}

    {components ? (
      <ul
        className={cn(
          compact
            ? "grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            : "divide-y divide-border overflow-y-auto rounded-xl border border-border",
          error && "opacity-60",
        )}
      >
        {components.map((component) => (
          <ComponentRow
            key={component.id}
            component={component}
            compact={compact}
          />
        ))}
      </ul>
    ) : error ? null : (
      <p className="text-sm text-muted-foreground">Loading...</p>
    )}
  </div>
)

const ComponentRow = ({
  component,
  compact,
}: {
  component: SystemComponentStatus
  compact: boolean
}) => {
  const state = STATE[component.state]

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3",
        compact
          ? "rounded-lg border border-border bg-surface-raised px-3 py-2"
          : "px-4 py-3",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {component.role}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {component.name}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className="flex items-center gap-2 text-xs text-foreground">
          <span aria-hidden="true" className={cn("status-dot", state.dot)} />
          {state.label}
        </span>
        {component.total > 0 ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {component.ready}/{component.total} ready
          </span>
        ) : null}
      </div>
    </li>
  )
}
