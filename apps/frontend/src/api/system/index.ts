import type {
  ControlPlaneDnsCheck,
  ControlPlaneSettings,
  SetControlPlaneUrlPayload,
} from '@acceleratio/shared';

import { api } from '@/api';

export const systemApi = {
  getControlPlane: async () => {
    const { data } = await api.get<ControlPlaneSettings>(
      '/system/control-plane',
    );
    return data;
  },
  setPending: async (payload: SetControlPlaneUrlPayload) => {
    const { data } = await api.put<ControlPlaneSettings>(
      '/system/control-plane/pending',
      payload,
    );
    return data;
  },
  checkDns: async () => {
    const { data } = await api.post<ControlPlaneDnsCheck>(
      '/system/control-plane/pending/dns-check',
    );
    return data;
  },
  cancelPending: async () => {
    const { data } = await api.delete<ControlPlaneSettings>(
      '/system/control-plane/pending',
    );
    return data;
  },
  apply: async () => {
    const { data } = await api.post<ControlPlaneSettings>(
      '/system/control-plane/apply',
    );
    return data;
  },
};
