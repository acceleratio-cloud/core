import type { V1Secret } from '@kubernetes/client-node';
import {
  backupState,
  restoreWindowStart,
  restoringFrom,
  toBackup,
} from '../postgres-backup.service';
import type { CnpgCluster } from '../postgres.manifests';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const secret = (phase: string, message?: string): V1Secret => ({
  metadata: {
    annotations: {
      'acceleratio.io/bucket-phase': phase,
      ...(message ? { 'acceleratio.io/bucket-message': message } : {}),
    },
  },
});

const cluster = (archiving?: 'True' | 'False'): CnpgCluster => ({
  apiVersion: 'postgresql.cnpg.io/v1',
  kind: 'Cluster',
  metadata: { name: 'db', namespace: 'ns' },
  spec: {},
  status: {
    conditions: archiving
      ? [
          {
            type: 'ContinuousArchiving',
            status: archiving,
            message: 'no bucket',
          },
        ]
      : [],
  },
});

describe('postgres backups', () => {
  it('derives the state from the bucket and WAL archiving', () => {
    expect(backupState(null, cluster()).state).toBe('provisioning');
    expect(backupState(secret('provisioning'), cluster()).state).toBe(
      'provisioning',
    );
    expect(backupState(secret('failed', 'denied'), cluster())).toEqual({
      state: 'failing',
      message: 'denied',
    });
    expect(backupState(secret('ready'), cluster('False'))).toEqual({
      state: 'failing',
      message: 'no bucket',
    });
    expect(backupState(secret('ready'), cluster('True')).state).toBe('active');
  });

  it('tells scheduled backups from ones started in the console', () => {
    expect(
      toBackup({
        metadata: {
          name: 'b1',
          labels: { 'cnpg.io/scheduled-backup': 'db-daily' },
        },
        status: { phase: 'completed', startedAt: '2026-11-10T03:00:00Z' },
      }),
    ).toEqual({
      name: 'b1',
      phase: 'completed',
      scheduled: true,
      started_at: '2026-11-10T03:00:00Z',
      stopped_at: null,
      error: null,
    });
    expect(toBackup({ metadata: { name: 'b2' } }).scheduled).toBe(false);
  });

  it('ignores a recoverability point older than every backup that exists', () => {
    const withPoint = (point: string): CnpgCluster => ({
      ...cluster('True'),
      status: { firstRecoverabilityPoint: point },
    });
    const completed = {
      metadata: { name: 'b' },
      status: { phase: 'completed', stoppedAt: '2026-11-11T09:16:00Z' },
    };

    // Stale point from before backups were turned off and on.
    expect(
      restoreWindowStart(withPoint('2026-11-11T07:41:11Z'), [completed]),
    ).toBe('2026-11-11T09:16:00Z');
    // Retention moved the window past the oldest backup object.
    expect(
      restoreWindowStart(withPoint('2026-11-12T03:00:10Z'), [completed]),
    ).toBe('2026-11-12T03:00:10Z');
    expect(
      restoreWindowStart(withPoint('2026-11-11T07:41:11Z'), [
        { metadata: { name: 'r' }, status: { phase: 'running' } },
      ]),
    ).toBeNull();
  });

  it('finds only restores still reading the bucket', () => {
    const restore = (phase: string, initialized: boolean): CnpgCluster => ({
      ...cluster('True'),
      spec: {
        externalClusters: [
          { barmanObjectStore: { destinationPath: 's3://pg-backup-src/' } },
        ],
      },
      status: {
        phase,
        conditions: initialized
          ? [{ type: 'Initialized', status: 'True' }]
          : [],
      },
    });

    expect(
      restoringFrom([restore('Setting up primary', false)], 'pg-backup-src'),
    ).toHaveLength(1);
    // Restored long ago and only restarting now.
    expect(
      restoringFrom(
        [restore('Waiting for the instances to become active', true)],
        'pg-backup-src',
      ),
    ).toHaveLength(0);
    expect(
      restoringFrom([restore('Unable to bootstrap', false)], 'pg-backup-src'),
    ).toHaveLength(0);
    expect(
      restoringFrom([restore('Setting up primary', false)], 'pg-backup-other'),
    ).toHaveLength(0);
  });
});
