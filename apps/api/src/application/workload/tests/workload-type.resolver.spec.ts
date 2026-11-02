import { NotFoundException } from '@nestjs/common';
import type { Database } from '@/vendor/db/database.constants';
import { workload } from '../schemas/workload.schema';
import { WorkloadTypeResolver } from '../workload-type.resolver';

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';

/**
 * Drizzle SQL nodes keep bound values on nested `Param` chunks. Collecting
 * them lets a test assert the lookup scope without a real database.
 */
const queryParams = (node: unknown): unknown[] => {
  const values: unknown[] = [];

  const visit = (current: unknown): void => {
    if (typeof current !== 'object' || current === null) {
      return;
    }

    const record = current as { value?: unknown; queryChunks?: unknown };

    if (record.constructor?.name === 'Param') {
      values.push(record.value);
    }

    if (Array.isArray(record.queryChunks)) {
      for (const chunk of record.queryChunks) {
        visit(chunk);
      }
    }
  };

  visit(node);

  return values;
};

const firstArgument = (mock: jest.Mock): unknown =>
  (mock.mock.calls as unknown[][])[0]?.[0];

const createResolver = () => {
  const limit = jest.fn();
  const where = jest.fn().mockReturnValue({ limit });
  const from = jest.fn().mockReturnValue({ where });
  const select = jest.fn().mockReturnValue({ from });
  const resolver = new WorkloadTypeResolver({
    select,
  } as unknown as Database);

  return { resolver, select, where, limit };
};

describe('WorkloadTypeResolver', () => {
  it('returns the type of the row scoped by project and id', async () => {
    const { resolver, select, where, limit } = createResolver();

    limit.mockResolvedValue([{ type: 'docker' }]);

    await expect(resolver.resolve(projectId, workloadId)).resolves.toBe(
      'docker',
    );
    expect(select).toHaveBeenCalledWith({ type: workload.type });
    expect(queryParams(firstArgument(where))).toEqual(
      expect.arrayContaining([workloadId, projectId]),
    );
  });

  it('reports a missing row as not found', async () => {
    const { resolver, limit } = createResolver();

    limit.mockResolvedValue([]);

    await expect(
      resolver.resolve(projectId, workloadId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(resolver.resolve(projectId, workloadId)).rejects.toThrow(
      'Workload not found',
    );
  });

  it('reads only the type column', async () => {
    const { resolver, select, limit } = createResolver();

    limit.mockResolvedValue([{ type: 'docker' }]);

    await resolver.resolve(projectId, workloadId);

    expect(select).toHaveBeenCalledTimes(1);
    expect(firstArgument(select)).toEqual({ type: workload.type });
  });
});
