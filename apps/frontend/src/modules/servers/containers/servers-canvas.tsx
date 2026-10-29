"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react"

import { CanvasControls } from "../components/canvas-controls"
import { nodeTypes } from "../components/graph-nodes"
import { buildGraph } from "../layout"
import { SEED_SERVERS, type Server } from "../mock-data"

const PROVISION_MS = 1600

export const ServersCanvas = () => (
  <ReactFlowProvider>
    <ServersGraph />
  </ReactFlowProvider>
)

const ServersGraph = () => {
  const [servers, setServers] = useState<Server[]>(SEED_SERVERS)
  const { fitView } = useReactFlow()

  const addServer = useCallback(() => {
    const index = servers.length + 1

    const server: Server = {
      id: `server-${String(index).padStart(2, "0")}`,
      name: `server-${String(index).padStart(2, "0")}`,
      role: "worker",
      ip: `10.0.0.${9 + index}`,
      cpu: 6,
      mem: 11,
      status: "provisioning",
    }

    setServers((current) => [...current, server])
  }, [servers])

  // a provisioned server becomes ready shortly after it joins the cluster
  useEffect(() => {
    const pending = servers.some((server) => server.status === "provisioning")
    if (!pending) return

    const timer = window.setTimeout(() => {
      setServers((current) =>
        current.map((server) =>
          server.status === "provisioning"
            ? { ...server, status: "ready" }
            : server
        )
      )
    }, PROVISION_MS)

    return () => window.clearTimeout(timer)
  }, [servers])

  // keep a newly added server in view without re-fitting on status changes
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    const timer = window.setTimeout(
      () => fitView({ duration: 250, padding: 0.12 }),
      80
    )

    return () => window.clearTimeout(timer)
  }, [servers.length, fitView])

  const { nodes, edges } = useMemo(
    () => buildGraph(servers, addServer),
    [servers, addServer]
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
            className="mt-2.5 text-sm text-muted-foreground"
          >
            {total} {total === 1 ? "server" : "servers"} · {ready} ready
            {notReady > 0 ? (
              <>
                {" · "}
                <span className="text-destructive">{notReady} not ready</span>
              </>
            ) : null}
          </p>
        </div>

        <ul className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <LegendItem dot="bg-foreground" label="Ready" />
          <LegendItem dot="bg-destructive" label="Not ready" />
          <LegendItem dot="border border-muted-foreground" label="Provisioning" />
        </ul>
      </div>

      <div className="min-h-0 flex-1 border bg-zinc-50 rounded-2xl m-4 mt-0 shadow-md">
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
          className="bg-neutral-50"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="#dedede"
          />
          <CanvasControls />
        </ReactFlow>
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
