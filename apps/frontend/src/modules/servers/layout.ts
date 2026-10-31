import type { Edge, Node } from "@xyflow/react"

import type { Server } from "./server"

export const SERVER_WIDTH = 264
export const SERVER_HEIGHT = 140

const GAP = 12
const HUB_GAP = 56
const CLUSTER_WIDTH = 220
const CLUSTER_HEIGHT = 64

const stackHeight = (count: number) => count * (SERVER_HEIGHT + GAP)

export const buildGraph = (servers: Server[]) => {
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
      name: "Cluster",
      meta: `${servers.length} ${
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

  return { nodes, edges }
}
