'use client';

import { useMemo } from 'react';
import type { Edge } from '@xyflow/react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';

import { CreateWorkloadDialog } from './create-workload-dialog';
import { CanvasLoader } from '@/shared/components/canvas-loader';
import { ProjectHeader } from '../components/project-header';
import { workloadNodeTypes } from '../components/workload-nodes';
import { useProject } from '../providers/project-provider';
import { toWorkloadNodes } from '../utils/workload-nodes';

const emptyEdges: Edge[] = [];

export const ProjectCanvas = () => (
  <ReactFlowProvider>
    <ProjectHeader />
    <div className="min-h-0 flex-1 relative">
      <div className="absolute top-2 right-4 z-10">
        <CreateWorkloadDialog />
      </div>
      <WorkloadFlow />
    </div>
  </ReactFlowProvider>
);

const WorkloadFlow = () => {
  const { workloads, isLoadingWorkloads } = useProject();
  const nodes = useMemo(() => toWorkloadNodes(workloads), [workloads]);

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={emptyEdges}
        nodeTypes={workloadNodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.15 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
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

      {isLoadingWorkloads ? (
        <CanvasLoader label="Loading services..." />
      ) : null}
    </>
  );
};
