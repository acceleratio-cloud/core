import { describe, expect, it, mock } from 'bun:test';

import type {
  ImportedService,
  Workload,
  WorkloadDomain,
  WorkloadDomains,
} from '@acceleratio/shared';
import {
  importService,
  type ImportApi,
  type ImportProgress,
} from '../utils/import-service';

const service: ImportedService = {
  name: 'web',
  config: { docker_image: 'nginx:1.27' },
  public_port: 80,
  ignored: [],
};

const workload = (id: string, name = 'web') =>
  ({ id, name, internal_domain: `${name}.internal` }) as Workload;

const domain = (hostname: string) =>
  ({ kind: 'generated', url: `https://${hostname}` }) as WorkloadDomain;

const domainList = (domains: WorkloadDomain[] = []) =>
  ({ domains }) as WorkloadDomains;

/** An API whose calls succeed unless a test overrides them. */
const fakeApi = (overrides: Partial<ImportApi> = {}) => {
  const api = {
    list: mock(() => Promise.resolve([] as Workload[])),
    create: mock(() => Promise.resolve(workload('w1'))),
    deploy: mock(() => Promise.resolve(workload('w1'))),
    domains: mock(() => Promise.resolve(domainList())),
    generate: mock(() => Promise.resolve(domain('web-1-2-3-4.sslip.io'))),
    ...overrides,
  };
  return api as typeof api & ImportApi;
};

const run = (
  api: ImportApi,
  progress: ImportProgress,
  known = new Set<string>(),
) =>
  importService({
    api,
    projectId: 'p1',
    service,
    progress,
    known,
    onCreated: () => {},
    onDeployed: () => {},
  });

describe('importService', () => {
  it('creates, deploys and publishes the service', async () => {
    const api = fakeApi();
    const progress: ImportProgress = {};

    const url = await run(api, progress);

    expect(url).toBe('https://web-1-2-3-4.sslip.io');
    expect(api.generate).toHaveBeenCalledWith('p1', 'w1', { port: 80 });
    expect(progress).toMatchObject({ deployed: true });
  });

  it('resumes at the step that failed', async () => {
    const api = fakeApi({
      generate: mock(() => Promise.reject(new Error('no public IP'))),
    });
    const progress: ImportProgress = {};
    await expect(run(api, progress)).rejects.toThrow('no public IP');

    api.generate = mock(() => Promise.resolve(domain('web-1-2-3-4.sslip.io')));
    await run(api, progress);

    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.deploy).toHaveBeenCalledTimes(1);
  });

  it('finds a create whose answer was lost instead of creating again', async () => {
    const api = fakeApi({
      create: mock(() => Promise.reject(new Error('Network Error'))),
      list: mock(() => Promise.resolve([workload('old'), workload('w1')])),
    });
    const progress: ImportProgress = {};
    await expect(run(api, progress, new Set(['old']))).rejects.toThrow();

    await run(api, progress, new Set(['old']));

    expect(api.create).toHaveBeenCalledTimes(1);
    expect(progress.workload?.id).toBe('w1');
  });

  it('never claims a service that was there before the import', async () => {
    const api = fakeApi({
      list: mock(() => Promise.resolve([workload('old')])),
    });
    api.create = mock(() => Promise.reject(new Error('Network Error')));
    const progress: ImportProgress = {};
    await expect(run(api, progress, new Set(['old']))).rejects.toThrow();

    api.create = mock(() => Promise.resolve(workload('w2')));
    await run(api, progress, new Set(['old']));

    expect(progress.workload?.id).toBe('w2');
  });

  it('reuses a domain made before its answer was lost', async () => {
    const api = fakeApi({
      domains: mock(() =>
        Promise.resolve(domainList([domain('web-abc123-1-2-3-4.sslip.io')])),
      ),
    });

    const url = await run(api, {});

    expect(url).toBe('https://web-abc123-1-2-3-4.sslip.io');
    expect(api.generate).not.toHaveBeenCalled();
  });
});
