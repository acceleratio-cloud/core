import type {
  CreateStorageClassPayload,
  StorageBenchmark,
  StorageBenchmarkHistory,
  StorageBenchmarkReport,
  StorageClass,
  StorageEnvironment,
  UpdateStorageClassPayload,
} from '@acceleratio/shared';

import { api } from '@/api';

export const storageClassesApi = {
  list: async () => {
    const { data } = await api.get<StorageClass[]>('/storage-classes');
    return data;
  },
  environment: async () => {
    const { data } = await api.get<StorageEnvironment>(
      '/storage-classes/environment',
    );
    return data;
  },
  create: async (payload: CreateStorageClassPayload) => {
    const { data } = await api.post<StorageClass>('/storage-classes', payload);
    return data;
  },
  update: async (id: string, payload: UpdateStorageClassPayload) => {
    const { data } = await api.patch<StorageClass>(
      `/storage-classes/${id}`,
      payload,
    );
    return data;
  },
  remove: async (id: string) => {
    await api.delete(`/storage-classes/${id}`);
  },
  benchmarks: async (id: string) => {
    const { data } = await api.get<StorageBenchmark[]>(
      `/storage-classes/${id}/benchmarks`,
    );
    return data;
  },
  /** Benchmark runs across all profiles, newest first. */
  benchmarkHistory: async (params: {
    storage_class_id?: string;
    before?: string;
    limit?: number;
  }) => {
    const { data } = await api.get<StorageBenchmarkHistory>(
      '/storage-benchmarks',
      { params },
    );
    return data;
  },
  benchmarkReport: async (id: string) => {
    const { data } = await api.get<StorageBenchmarkReport>(
      `/storage-benchmarks/${id}`,
    );
    return data;
  },
  startBenchmark: async (id: string) => {
    const { data } = await api.post<StorageBenchmark>(
      `/storage-classes/${id}/benchmarks`,
    );
    return data;
  },
};
