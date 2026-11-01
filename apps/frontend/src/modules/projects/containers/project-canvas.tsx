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
import { workloadNodeTypes } from '@/modules/workloads/components/workload-nodes';
import { toWorkloadNodes } from '@/modules/workloads/utils/workload-nodes';
import { CanvasLoader } from '@/shared/components/canvas-loader';
import { ProjectHeader } from '../components/project-header';
import { useProject } from '../providers/project-provider';
import { WorkloadDetails } from '@/modules/workloads/containers/workload-details';

const emptyEdges: Edge[] = [];

export const ProjectCanvas = () => {
  const { workloads } = useProject();
  const [selectedWorkloadId, setSelectedWorkloadId] = useState<string | null>(
    null,
  );

  const selectedWorkload =
    workloads.find((workload) => workload.id === selectedWorkloadId) ?? null;

  const closeDetails = useCallback(() => setSelectedWorkloadId(null), []);

  return (
    <ReactFlowProvider>
      <ProjectHeader />
      <div className="min-h-0 flex-1 relative">
        <div className="absolute top-2 right-4 z-10">
          <CreateWorkloadDialog />
        </div>
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
        className="bg-white"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={14}
          size={1}
          color="rgba(0, 0, 0, 0.3)"
        />
      </ReactFlow>

      {isLoadingWorkloads ? <CanvasLoader label="Loading services..." /> : null}
    </>
  );
};
