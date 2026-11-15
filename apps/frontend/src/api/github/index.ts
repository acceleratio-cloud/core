import type {
  CreateGithubAppPayload,
  GithubAppManifestRequest,
  GithubInstallUrl,
  GithubIntegration,
  GithubRepository,
} from '@acceleratio/shared';

import { api } from '@/api';

export const githubApi = {
  get: async () => {
    const { data } = await api.get<GithubIntegration>('/integrations/github');
    return data;
  },
  createManifest: async (payload: CreateGithubAppPayload) => {
    const { data } = await api.post<GithubAppManifestRequest>(
      '/integrations/github/apps/manifest',
      payload,
    );
    return data;
  },
  installUrl: async (id: string, returnUrl: string) => {
    const { data } = await api.post<GithubInstallUrl>(
      `/integrations/github/apps/${id}/install-url`,
      { return_url: returnUrl },
    );
    return data;
  },
  repositories: async (id: string) => {
    const { data } = await api.get<GithubRepository[]>(
      `/integrations/github/apps/${id}/repositories`,
    );
    return data;
  },
  /** Without an App id, the branches of a public repository. */
  branches: async (id: string | undefined, repository: string) => {
    const { data } = await api.get<string[]>(
      id
        ? `/integrations/github/apps/${id}/branches`
        : '/integrations/github/public/branches',
      { params: { repository } },
    );
    return data;
  },
  publicRepository: async (repository: string) => {
    const { data } = await api.get<Omit<GithubRepository, 'installation_id'>>(
      '/integrations/github/public/repository',
      { params: { repository } },
    );
    return data;
  },
  remove: async (id: string) => {
    await api.delete(`/integrations/github/apps/${id}`);
  },
};
