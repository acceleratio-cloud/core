'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type {
  EdgeTypes,
  NodeMouseHandler,
  NodeTypes,
  OnNodeDrag,
} from '@xyflow/react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import { sileo } from 'sileo';

import { getApiErrorMessage } from '@/api';
import { useAuth } from '@/modules/auth/providers/auth-provider';
import { canProject } from '@/modules/auth/utils/access';
import {
  CreateWorkloadDialog,
  type CreateStart,
} from '@/modules/workloads/containers/create-workload-dialog';
import { WorkloadDetails } from '@/modules/workloads/containers/workload-details';
import { workloadNodeTypes } from '@/modules/workloads/components/workload-nodes';
import type { WorkloadNode } from '@/modules/workloads/utils/workload-nodes';
import { toWorkloadNodes } from '@/modules/workloads/utils/workload-nodes';
import { CanvasLoader } from '@/shared/components/canvas-loader';
import {
  EmptyCanvasNodeCard,
  type EmptyCanvasNode,
} from '../components/empty-canvas-node';
import { TrafficEdge } from '../components/traffic-edge';
import { useProjectTraffic } from '../hooks/use-project-traffic';
import { SecurityAttentionProvider } from '@/modules/security/providers/security-attention-provider';
import { useProject, type FocusRequest } from '../providers/project-provider';
import {
  useProjectTabs,
  type ServiceRequest,
} from '../providers/project-tabs-provider';

const edgeTypes = { traffic: TrafficEdge } satisfies EdgeTypes;

const canvasNodeTypes = {
  ...workloadNodeTypes,
  empty: EmptyCanvasNodeCard,
} satisfies NodeTypes;

type CanvasNode = WorkloadNode | EmptyCanvasNode;

/** Where the API puts a project's first service: it appears where the empty state was. */
const FIRST_SERVICE_POSITION = { x: 0, y: 0 };

const formatRate = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

/**
 * Geometry of the details panel (`WorkloadDetails`: `top-16 right-2
 * bottom-2 w-3xl`, 48rem). The camera centers a selected node in the canvas
 * area the panel leaves visible.
 */
const PANEL_MAX_WIDTH = 768;
const PANEL_INSET = 8;
const PANEL_TOP = 64;
/** Below this much free width beside the panel, center on the whole canvas. */
const MIN_VISIBLE_WIDTH = 280;
const CAMERA_DURATION_MS = 450;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const subscribeReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/** Follows the reduced-motion preference for the camera and traffic dots. */
const usePrefersReducedMotion = () =>
  useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );

export const ProjectCanvas = () => {
  const { project, workloads, workloadsError } = useProject();
  const { access } = useAuth();
  const [selectedWorkloadId, setSelectedWorkloadId] = useState<string | null>(
    null,
  );
  const { serviceRequest } = useProjectTabs();
  // Starts empty: a canvas first shown by the request must still apply it.
  const [handledRequest, setHandledRequest] = useState<ServiceRequest | null>(
    null,
  );

  // Another tab asked to show a service: select it once per request.
  if (serviceRequest !== handledRequest) {
    setHandledRequest(serviceRequest);
    if (serviceRequest) {
      setSelectedWorkloadId(serviceRequest.id);
    }
  }

  const selectedWorkload =
    workloads.find((workload) => workload.id === selectedWorkloadId) ?? null;

  const closeDetails = useCallback(() => setSelectedWorkloadId(null), []);
  // Where the create dialog opened, or null while it is closed.
  const [createStart, setCreateStart] = useState<CreateStart | null>(null);
  const canEdit = canProject(access, project.id, 'edit');

  return (
    <SecurityAttentionProvider projectId={project.id}>
      <ReactFlowProvider>
        <div className="relative h-full min-h-0 flex-1 bg-surface-board">
          {/* The project header floats over the left of this row (see
            ProjectView); the create action stays with the canvas. */}
          {canEdit ? (
            <div className="pointer-events-none absolute top-3 right-3 z-10 flex h-10 items-center">
              <div className="pointer-events-auto shrink-0">
                <CreateWorkloadDialog
                  open={createStart !== null}
                  start={createStart ?? 'type'}
                  onOpenChange={(open) => setCreateStart(open ? 'type' : null)}
                />
              </div>
            </div>
          ) : null}
          {workloadsError ? (
            <p
              role="alert"
              className="absolute top-16 left-3 z-10 max-w-sm rounded-md border border-destructive/30 bg-background px-3 py-2 text-xs leading-relaxed text-destructive"
            >
              {workloadsError}
            </p>
          ) : null}
          <WorkloadDetails workload={selectedWorkload} onClose={closeDetails} />
          <WorkloadFlow
            selectedWorkloadId={selectedWorkloadId}
            onSelectWorkload={setSelectedWorkloadId}
            onClearSelection={closeDetails}
            onCreate={canEdit ? setCreateStart : undefined}
          />
        </div>
      </ReactFlowProvider>
    </SecurityAttentionProvider>
  );
};

const WorkloadFlow = ({
  selectedWorkloadId,
  onSelectWorkload,
  onClearSelection,
  onCreate,
}: {
  selectedWorkloadId: string | null;
  onSelectWorkload: (workloadId: string) => void;
  onClearSelection: () => void;
  /** Opens the create dialog; absent for a role that cannot add services. */
  onCreate?: (start: CreateStart) => void;
}) => {
  const {
    project,
    workloads,
    isLoadingWorkloads,
    workloadsError,
    moveWorkload,
    focusRequest,
  } = useProject();
  const { access } = useAuth();
  const traffic = useProjectTraffic(project.id);
  const reducedMotion = usePrefersReducedMotion();
  const { setCenter, getZoom, fitView } = useReactFlow();
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);
  // React Flow owns drag positions and node measurements. The effect keeps
  // the local list in sync with workloads (data, remote positions, creates and
  // deletes) without replacing a node that is currently under the pointer.
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const draggingIds = useRef(new Set<string>());

  useEffect(() => {
    setNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));

      const next: CanvasNode[] = toWorkloadNodes(workloads).map((node) => {
        // A service id never names the empty slot, so this is a service node.
        const current = currentById.get(node.id) as WorkloadNode | undefined;
        const isDragging = draggingIds.current.has(node.id);

        return {
          ...current,
          ...node,
          position: isDragging
            ? (current?.position ?? node.position)
            : node.position,
          measured: current?.measured,
          selected: node.id === selectedWorkloadId,
        };
      });

      // A loaded project without services shows where the first one goes.
      if (next.length === 0 && !isLoadingWorkloads && !workloadsError) {
        next.push({
          id: 'empty',
          type: 'empty',
          position: FIRST_SERVICE_POSITION,
          data: { onCreate },
          draggable: false,
          selectable: false,
          measured: currentById.get('empty')?.measured,
        });
      }

      return next;
    });
  }, [
    workloads,
    selectedWorkloadId,
    isLoadingWorkloads,
    workloadsError,
    onCreate,
    setNodes,
  ]);

  const edges = useMemo<TrafficEdge[]>(() => {
    const names = new Map(workloads.map((w) => [w.id, w.name]));

    return traffic.flatMap((link) => {
      const from = names.get(link.source);
      const to = names.get(link.target);

      return from && to
        ? [
            {
              id: `${link.source}->${link.target}`,
              type: 'traffic' as const,
              source: link.source,
              target: link.target,
              selectable: false,
              data: {
                flowsPerSecond: link.flows_per_second,
                twoWay: link.two_way,
                reducedMotion,
                label: `${from} ${link.two_way ? '↔' : '→'} ${to} · ${formatRate.format(link.flows_per_second)} flows/s`,
              },
            },
          ]
        : [];
    });
  }, [traffic, workloads, reducedMotion]);

  const handleNodeDragStart = useCallback<OnNodeDrag<CanvasNode>>((_, node) => {
    draggingIds.current.add(node.id);
  }, []);

  const handleNodeDragStop = useCallback<OnNodeDrag<CanvasNode>>(
    (_, node) => {
      draggingIds.current.delete(node.id);

      void moveWorkload(node.id, node.position).catch((error) => {
        sileo.error({
          title: 'Could not save the new position',
          description: getApiErrorMessage(error),
        });
      });
    },
    [moveWorkload],
  );

  /**
   * Glides the camera to put the node in the middle of the canvas or, with
   * the details panel open, of the part the panel leaves uncovered.
   */
  const centerNode = useCallback(
    (node: CanvasNode, besidePanel: boolean) => {
      const zoom = getZoom();
      const nodeWidth = node.measured?.width ?? 0;
      const nodeHeight = node.measured?.height ?? 0;
      const panelWidth = Math.min(
        PANEL_MAX_WIDTH,
        canvasWidth - PANEL_INSET * 2,
      );
      const visibleWidth = canvasWidth - panelWidth - PANEL_INSET;
      // Screen point the node should land on, in canvas pixels.
      const targetX =
        besidePanel && visibleWidth >= MIN_VISIBLE_WIDTH
          ? visibleWidth / 2
          : canvasWidth / 2;
      const targetY = besidePanel
        ? (PANEL_TOP + canvasHeight) / 2
        : canvasHeight / 2;

      // `setCenter` puts a flow point at the middle of the canvas, so shift
      // that point by the screen offset of the target, in flow units.
      void setCenter(
        node.position.x + nodeWidth / 2 + (canvasWidth / 2 - targetX) / zoom,
        node.position.y + nodeHeight / 2 + (canvasHeight / 2 - targetY) / zoom,
        {
          zoom,
          duration: reducedMotion ? 0 : CAMERA_DURATION_MS,
          ease: easeOutCubic,
        },
      );
    },
    [getZoom, setCenter, canvasWidth, canvasHeight, reducedMotion],
  );

  // Selecting a node opens the details panel beside it.
  const handleNodeClick = useCallback<NodeMouseHandler<CanvasNode>>(
    (_, node) => {
      if (node.type === 'empty') {
        return;
      }
      onSelectWorkload(node.id);
      centerNode(node, true);
    },
    [onSelectWorkload, centerNode],
  );

  // A request made before this canvas opened is not replayed on it.
  const handledFocus = useRef<FocusRequest | null>(focusRequest);

  // A create asked to show its services: move once their cards are on the
  // canvas and measured, so the camera knows where their middle is.
  useEffect(() => {
    if (!focusRequest || focusRequest === handledFocus.current) {
      return;
    }

    const targets = nodes.filter(({ id }) => focusRequest.ids.includes(id));

    if (
      targets.length < focusRequest.ids.length ||
      targets.some(({ measured }) => !measured?.width)
    ) {
      return;
    }

    handledFocus.current = focusRequest;

    if (targets.length === 1) {
      centerNode(targets[0], selectedWorkloadId !== null);
      return;
    }

    void fitView({
      nodes: targets,
      padding: 0.2,
      maxZoom: 1.15,
      duration: reducedMotion ? 0 : CAMERA_DURATION_MS,
      ease: easeOutCubic,
    });
  }, [
    focusRequest,
    nodes,
    centerNode,
    fitView,
    selectedWorkloadId,
    reducedMotion,
  ]);

  return (
    <>
      {/* Dragging is not a selection gesture, and Backspace must not hide a
          node locally without deleting it on the server. */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={canvasNodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={onClearSelection}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.15 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesConnectable={false}
        // Positions are saved: a read-only role gets a fixed layout.
        nodesDraggable={canProject(access, project.id, 'edit')}
        nodesFocusable={false}
        edgesFocusable={false}
        selectNodesOnDrag={false}
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

      {isLoadingWorkloads ? <CanvasLoader label="Loading services..." /> : null}
    </>
  );
};
