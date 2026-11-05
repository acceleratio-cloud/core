// The workload facade pulls in the Docker type service, which loads the
// ESM-only Kubernetes client. This suite only checks the version routes, so the
// facade is stubbed at the module boundary.
jest.mock('@/application/workload/workload.service', () => ({
  WorkloadService: class WorkloadService {},
}));

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import type { App } from 'supertest/types';
import { WorkloadEventsService } from '@/application/workload/observer/workload-events.service';
import { WorkloadController } from '@/application/workload/workload.controller';
import { WorkloadService } from '@/application/workload/workload.service';

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const versionId = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';
const base = `/projects/${projectId}/workloads/${workloadId}`;

describe('Workload versions (e2e)', () => {
  let app: INestApplication<App>;
  const facade = {
    listVersions: jest.fn(),
    getVersion: jest.fn(),
    rollback: jest.fn(),
    discardDraft: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkloadController],
      providers: [
        WorkloadEventsService,
        { provide: WorkloadService, useValue: facade },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists the versions of a workload', async () => {
    facade.listVersions.mockResolvedValue([{ id: versionId, number: 1 }]);

    const response = await supertest(app.getHttpServer())
      .get(`${base}/versions`)
      .expect(200);

    expect(facade.listVersions).toHaveBeenCalledWith(projectId, workloadId);
    expect(response.body).toEqual([{ id: versionId, number: 1 }]);
  });

  it('reads one version', async () => {
    facade.getVersion.mockResolvedValue({ id: versionId, number: 1 });

    await supertest(app.getHttpServer())
      .get(`${base}/versions/${versionId}`)
      .expect(200);

    expect(facade.getVersion).toHaveBeenCalledWith(
      projectId,
      workloadId,
      versionId,
    );
  });

  it('rolls back with 200 and returns the workload', async () => {
    facade.rollback.mockResolvedValue({ id: workloadId, status: 'deploying' });

    const response = await supertest(app.getHttpServer())
      .post(`${base}/versions/${versionId}/rollback`)
      .expect(200);

    expect(facade.rollback).toHaveBeenCalledWith(
      projectId,
      workloadId,
      versionId,
    );
    expect(response.body).toEqual({ id: workloadId, status: 'deploying' });
  });

  it('discards the draft', async () => {
    facade.discardDraft.mockResolvedValue({
      id: workloadId,
      draft_config: null,
    });

    await supertest(app.getHttpServer()).delete(`${base}/draft`).expect(200);

    expect(facade.discardDraft).toHaveBeenCalledWith(projectId, workloadId);
  });

  it('rejects a version id that is not a UUID', async () => {
    await supertest(app.getHttpServer())
      .post(`${base}/versions/latest/rollback`)
      .expect(400);

    expect(facade.rollback).not.toHaveBeenCalled();
  });
});
