"use client"

import { useEffect, useState } from "react"

import { getApiErrorMessage } from "@/api"
import { systemApi } from "@/api/system"
import type {
  SystemComponentState,
  SystemComponentStatus,
} from "@acceleratio/shared"
import { Skeleton } from "@/shared/components/ui/skeleton"
import { cn } from "@/lib/utils"

const REFRESH_MS = 30_000
const SKELETON_COUNT = 9

const STATE: Record<SystemComponentState, { label: string; dot: string }> = {
  operational: { label: "Operational", dot: "bg-status-success" },
  degraded: { label: "Degraded", dot: "bg-status-warning" },
  down: { label: "Down", dot: "bg-status-danger" },
  unknown: { label: "Unknown", dot: "bg-muted-foreground" },
}

/** Health of every platform component, refreshed while the page is open. */
export const SystemStatus = () => {
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

    load()
    const timer = setInterval(load, REFRESH_MS)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  const healthy =
    components?.every((component) => component.state === "operational") ??
    false

  return (
    <section aria-labelledby="system-status-heading" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="system-status-heading"
          className="text-base font-medium text-foreground"
        >
          System status
        </h2>
        {components ? (
          <p
            className={cn(
              "text-sm",
              healthy ? "text-muted-foreground" : "text-status-warning",
            )}
          >
            {healthy
              ? "All systems operational"
              : "Some components need attention"}
          </p>
        ) : null}
      </div>

      {error && !components ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : (
        <ul
          aria-busy={!components}
          className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
        >
          {components
            ? components.map((component) => (
                <ComponentRow key={component.id} component={component} />
              ))
            : Array.from({ length: SKELETON_COUNT }, (_, index) => (
                <li key={index}>
                  <Skeleton className="h-[58px] rounded-lg" />
                </li>
              ))}
        </ul>
      )}
    </section>
  )
}

const ComponentRow = ({ component }: { component: SystemComponentStatus }) => {
  const state = STATE[component.state]

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {component.role}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {component.name}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span className="flex items-center gap-1.5 text-xs text-foreground">
          <span
            aria-hidden="true"
            className={cn("size-2 rounded-full", state.dot)}
          />
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
