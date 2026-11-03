"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react"

import { getApiErrorMessage } from "@/api"
import { nodesApi } from "@/api/nodes"
import { CanvasLoader } from "@/shared/components/canvas-loader"
import { CanvasControls } from "../components/canvas-controls"
import { nodeTypes } from "../components/graph-nodes"
import { buildGraph } from "../layout"
import { toServer, type Server } from "../server"

export const ServersCanvas = () => (
  <ReactFlowProvider>
    <ServersGraph />
  </ReactFlowProvider>
)

const ServersGraph = () => {
  const [servers, setServers] = useState<Server[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    nodesApi
      .list()
      .then((nodes) => {
        if (active) {
          setServers(nodes.map(toServer))
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(getApiErrorMessage(requestError))
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const { nodes, edges } = useMemo(
    () =>
      isLoading || error
        ? { nodes: [], edges: [] }
        : buildGraph(servers),
    [error, isLoading, servers]
  )

  const total = servers.length
  const ready = servers.filter((server) => server.status === "ready").length
  const notReady = servers.filter(
    (server) => server.status === "not-ready"
  ).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-4">
        <div>
          <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
            Servers
          </h1>
          <p
            aria-live="polite"
            className={
              error
                ? "mt-2.5 text-sm text-destructive"
                : "mt-2.5 text-sm text-muted-foreground"
            }
          >
            {isLoading ? (
              "Loading servers..."
            ) : error ? (
              error
            ) : (
              <>
                {total} {total === 1 ? "server" : "servers"} · {ready} ready
                {notReady > 0 ? (
                  <>
                    {" · "}
                    <span className="text-destructive">
                      {notReady} not ready
                    </span>
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>

        <ul className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <LegendItem dot="bg-foreground" label="Ready" />
          <LegendItem dot="bg-destructive" label="Not ready" />
          <LegendItem dot="border border-muted-foreground" label="Unknown" />
        </ul>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-surface-board m-4 mt-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12, maxZoom: 1.15 }}
          minZoom={0.4}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={160}
            size={0}
            color="var(--edge-default)"
          />
          <CanvasControls />
        </ReactFlow>

        {isLoading ? <CanvasLoader label="Loading servers..." /> : null}
      </div>
    </div>
  )
}

const LegendItem = ({ dot, label }: { dot: string; label: string }) => (
  <li className="flex items-center gap-1.5">
    <span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} />
    {label}
  </li>
)
