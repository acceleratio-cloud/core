'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Edge } from '@xyflow/react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';

import { CreateWorkloadDialog } from '@/modules/workloads/containers/create-workload-dialog';
import { WorkloadDetails } from '@/modules/workloads/containers/workload-details';
import { workloadNodeTypes } from '@/modules/workloads/components/workload-nodes';
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
          onSelectWorkload={setSelectedWorkloadId}
          onClearSelection={closeDetails}
        />
      </div>
    </ReactFlowProvider>
  );
};

const WorkloadFlow = ({
  onSelectWorkload,
  onClearSelection,
}: {
  onSelectWorkload: (workloadId: string) => void;
  onClearSelection: () => void;
}) => {
  const { workloads, isLoadingWorkloads } = useProject();
  const nodes = useMemo(() => toWorkloadNodes(workloads), [workloads]);

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={emptyEdges}
        nodeTypes={workloadNodeTypes}
        onNodeClick={(_, node) => onSelectWorkload(node.id)}
        onPaneClick={onClearSelection}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.15 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={140}
          size={0}
          color="var(--edge-default)"
        />
      </ReactFlow>

      {isLoadingWorkloads ? <CanvasLoader label="Loading services..." /> : null}
    </>
  );
};
