import type {
  ControlPlaneDnsCheck,
  ControlPlaneSettings,
  PlatformUpdate,
  PlatformUpdateDetails,
  PlatformVersionInfo,
  SetControlPlaneUrlPayload,
  StartPlatformUpdatePayload,
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
  getPlatform: async () => {
    const { data } = await api.get<PlatformVersionInfo>('/system/platform');
    return data;
  },
  checkForUpdates: async () => {
    const { data } = await api.post<PlatformVersionInfo>(
      '/system/platform/check',
    );
    return data;
  },
  listUpdates: async () => {
    const { data } = await api.get<PlatformUpdate[]>(
      '/system/platform/updates',
    );
    return data;
  },
  startUpdate: async (payload: StartPlatformUpdatePayload) => {
    const { data } = await api.post<PlatformUpdateDetails>(
      '/system/platform/updates',
      payload,
    );
    return data;
  },
  getUpdate: async (id: string) => {
    const { data } = await api.get<PlatformUpdateDetails>(
      `/system/platform/updates/${encodeURIComponent(id)}`,
    );
    return data;
  },
};
