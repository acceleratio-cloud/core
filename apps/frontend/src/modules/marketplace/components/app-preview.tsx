'use client';

import { useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Globe, Plug } from 'lucide-react';

import type { MarketplaceApp, MarketplaceService } from '@acceleratio/shared';
import { DiskTile } from '@/modules/workloads/components/workload-cards/node-volumes';

import { AppIcon } from './app-icon';

/** Edges need handles; they stay invisible since nothing connects by hand. */
const Handles = ({ source = true, target = true }) => (
  <>
    {target ? (
      <Handle type="target" position={Position.Left} className="opacity-0" />
    ) : null}
    {source ? (
      <Handle type="source" position={Position.Right} className="opacity-0" />
    ) : null}
  </>
);

const disksOf = (service: MarketplaceService) =>
  service.type === 'postgres'
    ? [{ path: 'Data', size_gib: service.size_gib ?? 0 }]
    : (service.volumes ?? []);

type ServiceNodeType = Node<{ service: MarketplaceService }, 'service'>;

/** A service as the project canvas will show it once deployed. */
const ServiceNode = ({ data: { service } }: NodeProps<ServiceNodeType>) => {
  const disks = disksOf(service);

  return (
    <div className="w-66 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-float">
      <Handles />
      <div className="flex items-center gap-2.5 border-b border-edge-subtle bg-surface-muted/40 px-3 py-2.5">
        <AppIcon src={service.icon} className="size-7 rounded-md" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm leading-tight font-semibold tracking-tight text-foreground">
            {service.name}
          </span>
          {/* Wraps rather than truncates: the tag is what gets pulled. */}
          <span className="mt-0.5 font-mono text-[11px] leading-tight break-all text-muted-foreground">
            {service.image ?? 'Managed PostgreSQL 17'}
          </span>
        </div>
      </div>
      {service.port ? (
        <dl className="my-1 flex h-7 items-center gap-3 px-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Plug aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
            Port
          </dt>
          <dd className="ml-auto font-mono text-xs text-foreground tabular-nums">
            {service.port}
          </dd>
        </dl>
      ) : null}
      {disks.length > 0 ? (
        <ul aria-label="Disks" className="mx-3 mb-3 flex flex-col gap-1.5">
          {disks.map((disk) => (
            <DiskTile
              key={disk.path}
              label={disk.path}
              sizeGb={disk.size_gib}
              fill={null}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
};

const DomainNode = () => (
  <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 text-xs whitespace-nowrap text-muted-foreground shadow-float">
    <Handles target={false} />
    <Globe aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
    https://your-domain
  </div>
);

const nodeTypes = { service: ServiceNode, domain: DomainNode };

const COLUMN_GAP = 120;
const CARD_WIDTH = 264;
const DOMAIN_WIDTH = 170;
const ROW_GAP = 32;

/** Rough card height, for the first layout only; fitView uses the measured size. */
const estimateHeight = (service: MarketplaceService) =>
  60 + (service.port ? 36 : 0) + disksOf(service).length * 34 + 12;

const labelProps = {
  labelStyle: {
    fill: 'var(--fg-tertiary)',
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
  },
  labelBgStyle: { fill: 'var(--surface-board)' },
  labelBgPadding: [4, 2] as [number, number],
};

/** Domain → app → dependencies, left to right, the column centred on the app. */
const layout = (app: MarketplaceApp) => {
  const [main, ...deps] = app.services;
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const heights = deps.map(estimateHeight);
  const column =
    heights.reduce((sum, h) => sum + h, 0) + ROW_GAP * (deps.length - 1);
  const mainY = Math.max(column / 2 - estimateHeight(main) / 2, 0);
  const mainX = main.public ? DOMAIN_WIDTH + COLUMN_GAP : 0;

  if (main.public) {
    nodes.push({
      id: 'domain',
      type: 'domain',
      position: { x: 0, y: mainY + 16 },
      data: {},
    });
    edges.push({
      id: 'domain-main',
      source: 'domain',
      target: main.name,
      label: '443',
      ...labelProps,
    });
  }
  nodes.push({
    id: main.name,
    type: 'service',
    position: { x: mainX, y: mainY },
    data: { service: main },
  });

  let y = Math.max(estimateHeight(main) / 2 - column / 2, 0);
  deps.forEach((service, index) => {
    nodes.push({
      id: service.name,
      type: 'service',
      position: { x: mainX + CARD_WIDTH + COLUMN_GAP, y },
      data: { service },
    });
    edges.push({
      id: `${main.name}-${service.name}`,
      source: main.name,
      target: service.name,
      type: 'smoothstep',
      label: service.port ? `:${service.port}` : undefined,
      ...labelProps,
    });
    y += heights[index] + ROW_GAP;
  });

  return { nodes, edges };
};

/**
 * What the template creates, drawn on the same canvas as a project: the
 * public domain, the app and the services it reaches over the private
 * network. Fits itself on load; cards can be dragged, the view panned and
 * zoomed (pinch or ⌘/Ctrl + scroll, so the page still scrolls).
 */
export const AppPreview = ({ app }: { app: MarketplaceApp }) => {
  const initial = useMemo(() => layout(app), [app]);
  const [nodes, , onNodesChange] = useNodesState(initial.nodes);

  return (
    <div
      role="figure"
      aria-label={`${app.name} deploys ${app.services.map((s) => s.name).join(', ')}`}
      className="h-96 overflow-hidden rounded-lg border border-border bg-surface-board"
    >
      <ReactFlow
        nodes={nodes}
        edges={initial.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        minZoom={0.3}
        maxZoom={1.5}
        zoomOnScroll={false}
        preventScrolling={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--board-grid)"
        />
      </ReactFlow>
    </div>
  );
};
