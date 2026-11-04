'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge, NodeMouseHandler, OnNodeDrag } from '@xyflow/react';
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
import { CreateWorkloadDialog } from '@/modules/workloads/containers/create-workload-dialog';
import { WorkloadDetails } from '@/modules/workloads/containers/workload-details';
import { workloadNodeTypes } from '@/modules/workloads/components/workload-nodes';
import type { WorkloadNode } from '@/modules/workloads/utils/workload-nodes';
import { toWorkloadNodes } from '@/modules/workloads/utils/workload-nodes';
import { CanvasLoader } from '@/shared/components/canvas-loader';
import { ProjectHeader } from '../components/project-header';
import { useProject } from '../providers/project-provider';

const emptyEdges: Edge[] = [];

/**
 * Geometry of the details panel (`WorkloadDetails`: `top-16 right-3
 * bottom-3 w-3xl`, 48rem). The camera centers a selected node in the canvas
 * area the panel leaves visible.
 */
const PANEL_MAX_WIDTH = 768;
const PANEL_INSET = 12;
const PANEL_TOP = 64;
/** Below this much free width beside the panel, center on the whole canvas. */
const MIN_VISIBLE_WIDTH = 280;
const CAMERA_DURATION_MS = 450;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ProjectCanvas = () => {
  const { workloads, workloadsError } = useProject();
  const [selectedWorkloadId, setSelectedWorkloadId] = useState<string | null>(
    null,
  );

  const selectedWorkload =
    workloads.find((workload) => workload.id === selectedWorkloadId) ?? null;

  const closeDetails = useCallback(() => setSelectedWorkloadId(null), []);

  return (
    <ReactFlowProvider>
      <div className="relative min-h-0 flex-1 bg-surface-board">
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-3">
          <div className="pointer-events-auto min-w-0">
            <ProjectHeader />
          </div>
          <div className="pointer-events-auto shrink-0">
            <CreateWorkloadDialog />
          </div>
        </div>
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
        />
      </div>
    </ReactFlowProvider>
  );
};

const WorkloadFlow = ({
  selectedWorkloadId,
  onSelectWorkload,
  onClearSelection,
}: {
  selectedWorkloadId: string | null;
  onSelectWorkload: (workloadId: string) => void;
  onClearSelection: () => void;
}) => {
  const { workloads, isLoadingWorkloads, moveWorkload } = useProject();
  const { setCenter, getZoom } = useReactFlow();
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);
  // React Flow owns drag positions and node measurements. The effect keeps
  // the local list in sync with workloads (data, remote positions, creates and
  // deletes) without replacing a node that is currently under the pointer.
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkloadNode>([]);
  const draggingIds = useRef(new Set<string>());

  useEffect(() => {
    setNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));

      return toWorkloadNodes(workloads).map((node) => {
        const current = currentById.get(node.id);
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
    });
  }, [workloads, selectedWorkloadId, setNodes]);

  const handleNodeDragStart = useCallback<OnNodeDrag<WorkloadNode>>(
    (_, node) => {
      draggingIds.current.add(node.id);
    },
    [],
  );

  const handleNodeDragStop = useCallback<OnNodeDrag<WorkloadNode>>(
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

  // Selecting a node opens the details panel, so glide the camera to put the
  // node in the middle of the canvas the panel leaves uncovered.
  const handleNodeClick = useCallback<NodeMouseHandler<WorkloadNode>>(
    (_, node) => {
      onSelectWorkload(node.id);

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
        visibleWidth >= MIN_VISIBLE_WIDTH ? visibleWidth / 2 : canvasWidth / 2;
      const targetY = (PANEL_TOP + canvasHeight) / 2;

      // `setCenter` puts a flow point at the middle of the canvas, so shift
      // that point by the screen offset of the target, in flow units.
      void setCenter(
        node.position.x + nodeWidth / 2 + (canvasWidth / 2 - targetX) / zoom,
        node.position.y + nodeHeight / 2 + (canvasHeight / 2 - targetY) / zoom,
        {
          zoom,
          duration: prefersReducedMotion() ? 0 : CAMERA_DURATION_MS,
          ease: easeOutCubic,
        },
      );
    },
    [onSelectWorkload, getZoom, setCenter, canvasWidth, canvasHeight],
  );

  return (
    <>
      {/* Dragging is not a selection gesture, and Backspace must not hide a
          node locally without deleting it on the server. */}
      <ReactFlow
        nodes={nodes}
        edges={emptyEdges}
        nodeTypes={workloadNodeTypes}
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
          color="var(--edge-default)"
        />
      </ReactFlow>

      {isLoadingWorkloads ? <CanvasLoader label="Loading services..." /> : null}
    </>
  );
};
