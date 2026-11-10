import type { StaticRelease, Workload } from '@acceleratio/shared';

import { api } from '@/api';

const releasesPath = (projectId: string, id: string) =>
  `/projects/${projectId}/workloads/${id}/releases`;

/**
 * Uploads of a static site: a new release is filled file by file, then
 * published as the draft's files and deployed.
 */
export const staticReleasesApi = {
  create: async (projectId: string, id: string) => {
    const { data } = await api.post<StaticRelease>(releasesPath(projectId, id));
    return data;
  },
  /** Raw body, streamed by the API to SeaweedFS; the type rides in a header. */
  uploadFile: async (
    projectId: string,
    id: string,
    releaseId: string,
    path: string,
    file: File,
    options: {
      onProgress?: (loaded: number) => void;
      signal?: AbortSignal;
    } = {},
  ) => {
    await api.put(`${releasesPath(projectId, id)}/${releaseId}/files`, file, {
      params: { path },
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Content-Type': file.type || 'application/octet-stream',
      },
      signal: options.signal,
      onUploadProgress: (event) => options.onProgress?.(event.loaded),
    });
  },
  /** Makes the release the draft's files; the site's settings stay. */
  publish: async (projectId: string, id: string, releaseId: string) => {
    const { data } = await api.post<Workload>(
      `${releasesPath(projectId, id)}/${releaseId}/publish`,
    );
    return data;
  },
};
