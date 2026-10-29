import type { Edge, Node } from "@xyflow/react"

import { CLUSTER, type Server } from "./mock-data"

export const SERVER_WIDTH = 248
export const SERVER_HEIGHT = 104

const ADD_HEIGHT = 44
const GAP = 12
const HUB_GAP = 56
const CLUSTER_WIDTH = 220
const CLUSTER_HEIGHT = 64

const stackHeight = (count: number) => count * (SERVER_HEIGHT + GAP) + ADD_HEIGHT

export const buildGraph = (servers: Server[], onAddServer: () => void) => {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const height = stackHeight(servers.length)
  const serversX = CLUSTER_WIDTH + HUB_GAP

  nodes.push({
    id: "cluster",
    type: "cluster",
    position: {
      x: 0,
      y: Math.max(0, height / 2 - CLUSTER_HEIGHT / 2),
    },
    data: {
      name: CLUSTER.name,
      meta: `${CLUSTER.runtime} · ${servers.length} ${
        servers.length === 1 ? "server" : "servers"
      }`,
    },
    draggable: false,
  })

  servers.forEach((server, index) => {
    nodes.push({
      id: server.id,
      type: "server",
      position: { x: serversX, y: index * (SERVER_HEIGHT + GAP) },
      data: server,
      draggable: false,
    })

    edges.push({
      id: `cluster-${server.id}`,
      source: "cluster",
      target: server.id,
      type: "straight",
      style: { stroke: "var(--border)", strokeWidth: 1 },
    })
  })

  nodes.push({
    id: "add-server",
    type: "add",
    position: {
      x: serversX,
      y: servers.length * (SERVER_HEIGHT + GAP),
    },
    data: { onAdd: onAddServer },
    style: {
      width: SERVER_WIDTH,
      height: ADD_HEIGHT,
      pointerEvents: "auto",
    },
    draggable: false,
  })

  return { nodes, edges }
}
