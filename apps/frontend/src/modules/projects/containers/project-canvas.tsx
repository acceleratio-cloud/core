'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge, OnNodeDrag } from '@xyflow/react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
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

  return (
    <>
      {/* Dragging is not a selection gesture, and Backspace must not hide a
          node locally without deleting it on the server. */}
      <ReactFlow
        nodes={nodes}
        edges={emptyEdges}
        nodeTypes={workloadNodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onSelectWorkload(node.id)}
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
