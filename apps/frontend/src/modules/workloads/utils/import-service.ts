import type {
  CreateWorkloadPayload,
  GenerateWorkloadDomainPayload,
  ImportedService,
  Workload,
  WorkloadDomain,
  WorkloadDomains,
} from '@acceleratio/shared';

/** What one imported service already finished, so Retry resumes after it. */
export type ImportProgress = {
  workload?: Workload;
  deployed?: boolean;
  /** A create failed; it may still have gone through, so Retry looks first. */
  createFailed?: boolean;
};

/** The API calls an import makes; passed in so tests can stand in for them. */
export type ImportApi = {
  list: (projectId: string) => Promise<Workload[]>;
  create: (
    projectId: string,
    payload: CreateWorkloadPayload,
  ) => Promise<Workload>;
  deploy: (projectId: string, id: string) => Promise<Workload>;
  domains: (projectId: string, id: string) => Promise<WorkloadDomains>;
  generate: (
    projectId: string,
    id: string,
    payload: GenerateWorkloadDomainPayload,
  ) => Promise<WorkloadDomain>;
};

/**
 * Creates, deploys and publishes one imported service, skipping what
 * `progress` already holds. `known` holds the ids of services this service is
 * not, so a create whose answer was lost is found again instead of repeated.
 * Resolves to the public URL, if the service has one.
 */
export const importService = async ({
  api,
  projectId,
  service,
  progress,
  known,
  onCreated,
  onDeployed,
}: {
  api: ImportApi;
  projectId: string;
  service: ImportedService;
  progress: ImportProgress;
  known: Set<string>;
  onCreated: (workload: Workload) => void;
  onDeployed: (workload: Workload) => void;
}): Promise<string | undefined> => {
  if (!progress.workload && progress.createFailed) {
    progress.workload = (await api.list(projectId)).find(
      ({ id, name }) => name === service.name && !known.has(id),
    );

    if (progress.workload) {
      onCreated(progress.workload);
    }
  }

  if (!progress.workload) {
    try {
      progress.workload = await api.create(projectId, {
        name: service.name,
        type: 'docker',
        config: service.config,
      });
    } catch (error) {
      progress.createFailed = true;
      throw error;
    }

    onCreated(progress.workload);
  }

  const { id } = progress.workload;
  known.add(id);

  if (!progress.deployed) {
    onDeployed(await api.deploy(projectId, id));
    progress.deployed = true;
  }

  if (service.public_port === null) {
    return undefined;
  }

  // A retry after a lost answer may find the domain already made.
  const { domains } = await api.domains(projectId, id);
  const existing = domains.find(({ kind }) => kind === 'generated');

  return (
    existing?.url ??
    (await api.generate(projectId, id, { port: service.public_port })).url
  );
};
