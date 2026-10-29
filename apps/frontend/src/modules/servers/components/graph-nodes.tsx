"use client"

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import { Boxes, Plus } from "lucide-react"

import { cn } from "@/lib/utils"
import type { Server, ServerStatus } from "../mock-data"
import { Button } from "@/shared/components/ui/button"

type ServerNode = Node<Server, "server">
type ClusterNode = Node<
  { name: string; meta: string; [key: string]: unknown },
  "cluster"
>
type AddNode = Node<{ onAdd: () => void; [key: string]: unknown }, "add">

const statusStyles: Record<
  ServerStatus,
  { dot: string; text: string; label: string }
> = {
  ready: {
    dot: "bg-foreground",
    text: "text-muted-foreground",
    label: "Ready",
  },
  "not-ready": {
    dot: "bg-destructive",
    text: "text-destructive",
    label: "Not ready",
  },
  provisioning: {
    dot: "border border-muted-foreground bg-transparent",
    text: "text-muted-foreground",
    label: "Provisioning",
  },
}

const ServerNodeCard = ({ data }: NodeProps<ServerNode>) => {
  const status = statusStyles[data.status]
  const loaded = data.status === "ready"

  return (
    <div className="flex h-[104px] w-[248px] flex-col rounded-lg border border-border bg-white px-3 py-2.5">
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div className="flex items-center gap-2">
        <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} />
        <span className="truncate text-[13px] font-medium text-foreground">
          {data.name}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {data.role}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {data.ip}
        </span>
        <span className={cn("shrink-0 text-[11px]", status.text)}>
          {status.label}
        </span>
      </div>

      <div className="mt-auto grid grid-cols-2 gap-3">
        <Meter label="CPU" value={loaded ? data.cpu : null} />
        <Meter label="MEM" value={loaded ? data.mem : null} />
      </div>
    </div>
  )
}

const Meter = ({ label, value }: { label: string; value: number | null }) => (
  <div>
    <div className="flex items-baseline justify-between text-[10px] leading-none text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono">
        {value === null ? "—" : `${value}%`}
      </span>
    </div>
    <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full bg-foreground/60"
        style={{ width: `${value ?? 0}%` }}
      />
    </div>
  </div>
)

const ClusterNodeCard = ({ data }: NodeProps<ClusterNode>) => (
  <div className="w-[220px] rounded-lg border border-border bg-background px-3 py-2.5">
    <Handle type="source" position={Position.Right} className="opacity-0" />
    <div className="flex items-center gap-2">
      <Boxes
        aria-hidden="true"
        strokeWidth={1.75}
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="truncate text-[13px] font-medium text-foreground">
        {data.name}
      </span>
    </div>
    <p className="mt-1 text-[11px] text-muted-foreground">{data.meta}</p>
  </div>
)

const AddNodeCard = ({ data }: NodeProps<AddNode>) => (
  <Button
    type="button"
    onClick={data.onAdd}
    aria-label="Add server"
    className="w-full rounded-md border-dashed text-xs"
    variant="outline"
  >
    <Plus aria-hidden="true" strokeWidth={2} className="size-3" />
    Add server
  </Button>
)

export const nodeTypes = {
  server: ServerNodeCard,
  cluster: ClusterNodeCard,
  add: AddNodeCard,
}
