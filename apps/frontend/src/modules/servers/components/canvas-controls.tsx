"use client"

import { Panel, useReactFlow } from "@xyflow/react"
import { Maximize2, Minus, Plus } from "lucide-react"

const buttonClass =
  "flex size-7 items-center justify-center text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/50"

export const CanvasControls = () => {
  const { zoomIn, zoomOut, fitView } = useReactFlow()

  return (
    <Panel
      position="bottom-right"
      className="flex items-center overflow-hidden rounded-lg border border-border bg-background"
    >
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => zoomIn({ duration: 150 })}
        className={buttonClass}
      >
        <Plus aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      </button>
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => zoomOut({ duration: 150 })}
        className={buttonClass}
      >
        <Minus aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      </button>
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <button
        type="button"
        aria-label="Fit graph to view"
        onClick={() => fitView({ duration: 200, padding: 0.18 })}
        className={buttonClass}
      >
        <Maximize2 aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
      </button>
    </Panel>
  )
}
