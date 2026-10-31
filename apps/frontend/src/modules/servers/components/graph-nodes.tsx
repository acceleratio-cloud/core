"use client"

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import {
  Boxes,
  Cpu,
  HardDrive,
  MemoryStick,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import type { Server, ServerStatus } from "../server"

type ServerNode = Node<Server, "server">
type ClusterNode = Node<
  { name: string; meta: string; [key: string]: unknown },
  "cluster"
>

const statusStyles: Record<
  ServerStatus,
  { dot: string; text: string; stripe: string; label: string }
> = {
  ready: {
    dot: "bg-foreground",
    text: "text-muted-foreground",
    stripe: "bg-foreground/15",
    label: "Ready",
  },
  "not-ready": {
    dot: "bg-destructive",
    text: "text-destructive",
    stripe: "bg-destructive",
    label: "Not ready",
  },
  unknown: {
    dot: "border border-muted-foreground bg-transparent",
    text: "text-muted-foreground",
    stripe: "bg-transparent",
    label: "Unknown",
  },
}

const ServerNodeCard = ({ data }: NodeProps<ServerNode>) => {
  const status = statusStyles[data.status]
  const build = [data.version, data.os].filter(Boolean).join(" · ")

  return (
    <div className="relative flex w-[264px] flex-col overflow-hidden rounded-[10px] border border-border bg-white">
      <span
        aria-hidden="true"
        className={cn("absolute inset-x-0 top-0 h-0.5", status.stripe)}
      />
      <Handle type="target" position={Position.Left} className="opacity-0" />

      <div className="px-3 pt-3">
        <p
          title={data.name}
          className="truncate text-[13px] leading-none font-medium tracking-tight text-foreground"
        >
          {data.name}
        </p>

        <div className="flex items-center justify-between gap-2 pt-2">
          <span
            title={data.ip}
            className="truncate font-mono text-[11px] leading-none text-muted-foreground"
          >
            {data.ip}
          </span>
          <span className="shrink-0 rounded-full border border-border px-2 py-[3px] text-[10px] leading-none font-medium text-muted-foreground">
            {data.role}
          </span>
        </div>
      </div>

      <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-border px-3 pt-2.5">
        <Metric icon={Cpu} label="vCPU" value={data.cpu} />
        <Metric icon={MemoryStick} label="RAM" value={data.ram} />
        <Metric icon={HardDrive} label="Storage" value={data.storage} />
      </dl>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <span className="flex shrink-0 items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn("size-1.5 rounded-full", status.dot)}
          />
          <span className={cn("text-[11px] leading-none", status.text)}>
            {status.label}
          </span>
        </span>
        <span
          title={build || undefined}
          className="truncate font-mono text-[10px] leading-none text-muted-foreground"
        >
          {build}
        </span>
      </div>
    </div>
  )
}

const Metric = ({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string | null
}) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <dt className="flex items-center gap-1 text-[10px] leading-none text-muted-foreground">
      <Icon aria-hidden="true" strokeWidth={1.75} className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </dt>
    <dd
      title={value ?? undefined}
      className={cn(
        "truncate font-mono text-[11px] leading-none tabular-nums",
        value ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {value ?? "—"}
    </dd>
  </div>
)

const ClusterNodeCard = ({ data }: NodeProps<ClusterNode>) => (
  <div className="w-[220px] rounded-[10px] border border-border bg-background px-3 py-2.5">
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

export const nodeTypes = {
  server: ServerNodeCard,
  cluster: ClusterNodeCard,
}
