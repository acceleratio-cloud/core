import type {
  AddNodePayload,
  ClusterNode,
  DeleteNodePayload,
  DrainNodePayload,
  NodeDrainPlan,
  NodeOperation,
  NodePreflightResult,
  PreflightNodePayload,
  UpdateNodeLabelsPayload,
  UpdateNodeTaintsPayload,
} from '@acceleratio/shared';

import { api } from '@/api';

const nodePath = (name: string) => `/nodes/${encodeURIComponent(name)}`;

export const nodesApi = {
  list: async () => {
    const { data } = await api.get<ClusterNode[]>('/nodes');
    return data;
  },

  cordon: async (name: string) => {
    const { data } = await api.post<ClusterNode>(`${nodePath(name)}/cordon`);
    return data;
  },

  uncordon: async (name: string) => {
    const { data } = await api.post<ClusterNode>(`${nodePath(name)}/uncordon`);
    return data;
  },

  updateLabels: async (name: string, payload: UpdateNodeLabelsPayload) => {
    const { data } = await api.put<ClusterNode>(
      `${nodePath(name)}/labels`,
      payload,
    );
    return data;
  },

  updateTaints: async (name: string, payload: UpdateNodeTaintsPayload) => {
    const { data } = await api.put<ClusterNode>(
      `${nodePath(name)}/taints`,
      payload,
    );
    return data;
  },

  drainPlan: async (name: string) => {
    const { data } = await api.get<NodeDrainPlan>(
      `${nodePath(name)}/drain-plan`,
    );
    return data;
  },

  drain: async (name: string, payload: DrainNodePayload) => {
    const { data } = await api.post<NodeOperation>(
      `${nodePath(name)}/drain`,
      payload,
    );
    return data;
  },

  remove: async (name: string, payload: DeleteNodePayload) => {
    const { data } = await api.delete<NodeOperation>(nodePath(name), {
      data: payload,
    });
    return data;
  },

  operation: async (name: string) => {
    const { data } = await api.get<NodeOperation>(
      `${nodePath(name)}/operation`,
    );
    return data;
  },

  preflight: async (payload: PreflightNodePayload) => {
    const { data } = await api.post<NodePreflightResult>(
      '/nodes/preflight',
      payload,
    );
    return data;
  },

  add: async (payload: AddNodePayload) => {
    const { data } = await api.post<NodeOperation>('/nodes', payload);
    return data;
  },
};
