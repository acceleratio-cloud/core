import type {
  S3BucketCredentials,
  S3BucketEntry,
  S3BucketListing,
} from '@acceleratio/shared';

import { api, getApiBaseUrl } from '@/api';

const objectsPath = (projectId: string, id: string) =>
  `/projects/${projectId}/workloads/${id}/objects`;

/** Browsing, uploading to and editing the contents of an S3 bucket. */
export const s3BucketObjectsApi = {
  list: async (projectId: string, id: string, prefix: string) => {
    const { data } = await api.get<S3BucketListing>(
      objectsPath(projectId, id),
      {
        params: { prefix },
      },
    );
    return data;
  },
  createFolder: async (projectId: string, id: string, path: string) => {
    const { data } = await api.post<S3BucketEntry>(
      `${objectsPath(projectId, id)}/folders`,
      { path },
    );
    return data;
  },
  /**
   * Sends the file as the raw body: the API streams it to object storage without
   * holding it in memory. The file's own type rides in a header because the
   * body type must stay `application/octet-stream`.
   */
  upload: async (
    projectId: string,
    id: string,
    path: string,
    file: File,
    options: {
      onProgress?: (loaded: number) => void;
      signal?: AbortSignal;
    } = {},
  ) => {
    const { data } = await api.put<S3BucketEntry>(
      `${objectsPath(projectId, id)}/content`,
      file,
      {
        params: { path },
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Content-Type': file.type || 'application/octet-stream',
        },
        signal: options.signal,
        onUploadProgress: (event) => options.onProgress?.(event.loaded),
      },
    );
    return data;
  },
  /** A link the browser follows to download, so the file is never buffered. */
  downloadUrl: (projectId: string, id: string, path: string) => {
    const baseUrl = getApiBaseUrl();
    const query = new URLSearchParams({ path });

    return `${baseUrl}${objectsPath(projectId, id)}/content?${query}`;
  },
  remove: async (
    projectId: string,
    id: string,
    path: string,
    kind: S3BucketEntry['kind'],
  ) => {
    await api.delete(objectsPath(projectId, id), { params: { path, kind } });
  },
  /** New keys; the old ones stop working at once. */
  rotateCredentials: async (projectId: string, id: string) => {
    const { data } = await api.post<S3BucketCredentials>(
      `/projects/${projectId}/workloads/${id}/credentials/rotate`,
    );
    return data;
  },
};
