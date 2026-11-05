import { WorkloadMutationGuard } from '../workload-mutation-guard';

const TTL_MS = 5 * 60 * 1000;
const NOW = new Date('2026-11-02T10:00:00.000Z');

describe('WorkloadMutationGuard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports an unknown workload as never mutated', () => {
    expect(new WorkloadMutationGuard().mutatedAt('unknown')).toBe(0);
  });

  it('records the mutation time', () => {
    const guard = new WorkloadMutationGuard();

    guard.noteMutation('workload');

    expect(guard.mutatedAt('workload')).toBe(NOW.getTime());
  });

  it('keeps the latest mutation and isolates workloads', () => {
    const guard = new WorkloadMutationGuard();

    guard.noteMutation('first');
    jest.advanceTimersByTime(1000);
    guard.noteMutation('second');

    expect(guard.mutatedAt('first')).toBe(NOW.getTime());
    expect(guard.mutatedAt('second')).toBe(NOW.getTime() + 1000);
  });

  it('keeps a mutation for exactly the ttl', () => {
    const guard = new WorkloadMutationGuard();

    guard.noteMutation('workload');
    jest.advanceTimersByTime(TTL_MS);

    expect(guard.mutatedAt('workload')).toBe(NOW.getTime());
  });

  it('expires a mutation after the ttl', () => {
    const guard = new WorkloadMutationGuard();

    guard.noteMutation('workload');
    jest.advanceTimersByTime(TTL_MS + 1);

    expect(guard.mutatedAt('workload')).toBe(0);
  });

  it('prunes expired entries when a new mutation arrives', () => {
    const guard = new WorkloadMutationGuard();

    guard.noteMutation('old');
    jest.advanceTimersByTime(TTL_MS + 1);
    guard.noteMutation('new');

    expect(guard.mutatedAt('old')).toBe(0);
    expect(guard.mutatedAt('new')).toBe(Date.now());
  });
});
