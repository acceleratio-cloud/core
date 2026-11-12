import type {
  V1ContainerStatus,
  V1Deployment,
  V1DeploymentCondition,
  V1Pod,
  V1PodCondition,
} from '@kubernetes/client-node';
import { deriveStatus } from '../docker-workload.status';

interface DeploymentOptions {
  replicas?: number;
  generation?: number;
  observedGeneration?: number;
  updatedReplicas?: number;
  unavailableReplicas?: number;
  conditions?: V1DeploymentCondition[];
}

const createDeployment = (options: DeploymentOptions = {}): V1Deployment => ({
  metadata: { name: 'my-api', generation: options.generation },
  spec: {
    // An explicit undefined keeps the field unset, which means one replica.
    replicas: 'replicas' in options ? options.replicas : 1,
    selector: { matchLabels: {} },
    template: {},
  },
  status: {
    conditions: options.conditions,
    observedGeneration: options.observedGeneration,
    updatedReplicas: options.updatedReplicas,
    unavailableReplicas: options.unavailableReplicas,
  },
});

const availableDeployment = (options: DeploymentOptions = {}): V1Deployment =>
  createDeployment({
    conditions: [{ type: 'Available', status: 'True' }],
    updatedReplicas: 1,
    unavailableReplicas: 0,
    ...options,
  });

const containerStatus = (
  overrides: Partial<V1ContainerStatus> = {},
): V1ContainerStatus => ({
  name: 'main',
  image: 'nginx:1.25',
  imageID: '',
  ready: false,
  restartCount: 0,
  ...overrides,
});

const waiting = (reason: string, message?: string): V1ContainerStatus =>
  containerStatus({ state: { waiting: { reason, message } } });

const oomKilled = (message?: string): V1ContainerStatus =>
  containerStatus({
    state: { terminated: { reason: 'OOMKilled', message, exitCode: 137 } },
  });

const restartedAfterOom = (message?: string): V1ContainerStatus =>
  containerStatus({
    state: { running: {} },
    restartCount: 1,
    lastState: { terminated: { reason: 'OOMKilled', message, exitCode: 137 } },
  });

const createPod = (
  containerStatuses: V1ContainerStatus[],
  conditions?: V1PodCondition[],
  initContainerStatuses?: V1ContainerStatus[],
): V1Pod => ({
  metadata: { labels: {} },
  status: { containerStatuses, conditions, initContainerStatuses },
});

describe('deriveStatus', () => {
  it('keeps a never-deployed workload in draft', () => {
    expect(deriveStatus(undefined, [])).toEqual({
      status: 'draft',
      status_message: null,
    });
  });

  it('reports a scaled-to-zero Deployment as stopped', () => {
    expect(deriveStatus(createDeployment({ replicas: 0 }), [])).toEqual({
      status: 'stopped',
      status_message: null,
    });
  });

  it('lets stopped win over a failing pod', () => {
    expect(
      deriveStatus(createDeployment({ replicas: 0 }), [
        createPod([waiting('CrashLoopBackOff', 'back-off restarting')]),
      ]),
    ).toEqual({ status: 'stopped', status_message: null });
  });

  it('lets stopped win over ProgressDeadlineExceeded', () => {
    expect(
      deriveStatus(
        createDeployment({
          replicas: 0,
          conditions: [
            {
              type: 'Progressing',
              status: 'False',
              reason: 'ProgressDeadlineExceeded',
              message: 'timed out',
            },
          ],
        }),
        [],
      ),
    ).toEqual({ status: 'stopped', status_message: null });
  });

  it('treats an unset replicas field as one replica', () => {
    expect(
      deriveStatus(availableDeployment({ replicas: undefined }), []),
    ).toEqual({ status: 'running', status_message: null });
  });

  it('reports deploying while observedGeneration is behind', () => {
    expect(
      deriveStatus(
        availableDeployment({ generation: 3, observedGeneration: 2 }),
        [],
      ),
    ).toEqual({ status: 'deploying', status_message: null });
  });

  it('lets an outdated generation win over a failing pod', () => {
    expect(
      deriveStatus(
        createDeployment({
          generation: 3,
          observedGeneration: 2,
          conditions: [{ type: 'Available', status: 'False' }],
        }),
        [createPod([waiting('CrashLoopBackOff')])],
      ),
    ).toEqual({ status: 'deploying', status_message: null });
  });

  it('accepts an observedGeneration equal to the generation', () => {
    expect(
      deriveStatus(
        availableDeployment({ generation: 3, observedGeneration: 3 }),
        [],
      ),
    ).toEqual({ status: 'running', status_message: null });
  });

  it('accepts an observedGeneration ahead of the generation', () => {
    expect(
      deriveStatus(
        availableDeployment({ generation: 3, observedGeneration: 4 }),
        [],
      ),
    ).toEqual({ status: 'running', status_message: null });
  });

  it('reports failed with the message for ProgressDeadlineExceeded', () => {
    expect(
      deriveStatus(
        createDeployment({
          conditions: [
            {
              type: 'Progressing',
              status: 'False',
              reason: 'ProgressDeadlineExceeded',
              message: 'ReplicaSet has timed out progressing',
            },
          ],
        }),
      ),
    ).toEqual({
      status: 'failed',
      status_message: 'ReplicaSet has timed out progressing',
    });
  });

  it('falls back to a fixed message for a deadline without one', () => {
    expect(
      deriveStatus(
        createDeployment({
          conditions: [
            {
              type: 'Progressing',
              status: 'False',
              reason: 'ProgressDeadlineExceeded',
            },
          ],
        }),
      ),
    ).toEqual({
      status: 'failed',
      status_message: 'Progress deadline exceeded',
    });
  });

  it('lets the deadline win over an Available condition and a pod', () => {
    expect(
      deriveStatus(
        createDeployment({
          conditions: [
            { type: 'Available', status: 'True' },
            {
              type: 'Progressing',
              status: 'False',
              reason: 'ProgressDeadlineExceeded',
              message: 'timed out',
            },
          ],
        }),
        [createPod([waiting('ImagePullBackOff')])],
      ),
    ).toEqual({ status: 'failed', status_message: 'timed out' });
  });

  it('keeps a non-deadline Progressing=False condition as deploying', () => {
    expect(
      deriveStatus(
        createDeployment({
          conditions: [
            {
              type: 'Progressing',
              status: 'False',
              reason: 'ReplicaSetUpdated',
            },
          ],
        }),
      ),
    ).toEqual({ status: 'deploying', status_message: null });
  });

  it('reports failed with the message for ReplicaFailure=True', () => {
    expect(
      deriveStatus(
        createDeployment({
          conditions: [
            {
              type: 'ReplicaFailure',
              status: 'True',
              message: 'failed to create pod',
            },
          ],
        }),
      ),
    ).toEqual({ status: 'failed', status_message: 'failed to create pod' });
  });

  it('falls back to a fixed message for a replica failure without one', () => {
    expect(
      deriveStatus(
        createDeployment({
          conditions: [{ type: 'ReplicaFailure', status: 'True' }],
        }),
      ),
    ).toEqual({
      status: 'failed',
      status_message: 'Replica creation failed',
    });
  });

  it('ignores a ReplicaFailure condition that is not True', () => {
    expect(
      deriveStatus(
        createDeployment({
          conditions: [{ type: 'ReplicaFailure', status: 'False' }],
        }),
      ),
    ).toEqual({ status: 'deploying', status_message: null });
  });

  it.each([
    'ImagePullBackOff',
    'ErrImagePull',
    'ErrImageNeverPull',
    'InvalidImageName',
    'CrashLoopBackOff',
    'CreateContainerConfigError',
    'CreateContainerError',
    'RunContainerError',
  ])('reports failed for a pod in %s', (reason) => {
    expect(
      deriveStatus(createDeployment(), [createPod([waiting(reason)])]),
    ).toEqual({
      status: 'failed',
      status_message: reason,
    });
  });

  it('includes the container message in status_message', () => {
    expect(
      deriveStatus(createDeployment(), [
        createPod([
          waiting('ImagePullBackOff', 'Back-off pulling image "nginx:9"'),
        ]),
      ]),
    ).toEqual({
      status: 'failed',
      status_message: 'ImagePullBackOff: Back-off pulling image "nginx:9"',
    });
  });

  it('inspects init container failures too', () => {
    expect(
      deriveStatus(createDeployment(), [
        createPod([], undefined, [
          waiting('CreateContainerConfigError', 'secret not found'),
        ]),
      ]),
    ).toEqual({
      status: 'failed',
      status_message: 'CreateContainerConfigError: secret not found',
    });
  });

  it('reports failed for an unschedulable pod', () => {
    expect(
      deriveStatus(createDeployment(), [
        createPod(
          [],
          [
            {
              type: 'PodScheduled',
              status: 'False',
              reason: 'Unschedulable',
              message: '0/3 nodes are available',
            },
          ],
        ),
      ]),
    ).toEqual({
      status: 'failed',
      status_message: 'Unschedulable: 0/3 nodes are available',
    });
  });

  it('keeps deploying while a new volume is provisioned', () => {
    expect(
      deriveStatus(createDeployment(), [
        createPod(
          [],
          [
            {
              type: 'PodScheduled',
              status: 'False',
              reason: 'Unschedulable',
              message:
                '0/1 nodes are available: pod has unbound immediate PersistentVolumeClaims. not found',
            },
          ],
        ),
      ]),
    ).toEqual({ status: 'deploying', status_message: null });
  });

  it('keeps a PodScheduled=False pod without Unschedulable deploying', () => {
    expect(
      deriveStatus(createDeployment(), [
        createPod(
          [],
          [
            {
              type: 'PodScheduled',
              status: 'False',
              reason: 'SchedulingGated',
            },
          ],
        ),
      ]),
    ).toEqual({ status: 'deploying', status_message: null });
  });

  it('reports failed when the current container state is OOMKilled', () => {
    expect(
      deriveStatus(createDeployment(), [
        createPod([oomKilled('container exceeded its memory limit')]),
      ]),
    ).toEqual({
      status: 'failed',
      status_message: 'OOMKilled: container exceeded its memory limit',
    });
  });

  it('reports failed with the bare reason for OOMKilled without a message', () => {
    expect(
      deriveStatus(createDeployment(), [createPod([oomKilled()])]),
    ).toEqual({ status: 'failed', status_message: 'OOMKilled' });
  });

  it('keeps an available Deployment running after a historical OOMKilled restart', () => {
    expect(
      deriveStatus(availableDeployment(), [
        createPod([restartedAfterOom('container exceeded its memory limit')]),
      ]),
    ).toEqual({ status: 'running', status_message: null });
  });

  it('reports running when every replica is updated and available', () => {
    expect(deriveStatus(availableDeployment(), [])).toEqual({
      status: 'running',
      status_message: null,
    });
  });

  it('treats a missing unavailableReplicas as zero', () => {
    expect(
      deriveStatus(availableDeployment({ unavailableReplicas: undefined }), []),
    ).toEqual({ status: 'running', status_message: null });
  });

  it('lets a failing pod win over an Available condition', () => {
    expect(
      deriveStatus(availableDeployment(), [
        createPod([waiting('ImagePullBackOff')]),
      ]),
    ).toEqual({ status: 'failed', status_message: 'ImagePullBackOff' });
  });

  it('reports deploying while updatedReplicas is behind', () => {
    expect(
      deriveStatus(availableDeployment({ updatedReplicas: 0 }), []),
    ).toEqual({ status: 'deploying', status_message: null });
  });

  it('reports deploying while updatedReplicas trails a larger rollout', () => {
    expect(
      deriveStatus(
        availableDeployment({ replicas: 2, updatedReplicas: 1 }),
        [],
      ),
    ).toEqual({ status: 'deploying', status_message: null });
  });

  it('reports deploying while replicas are unavailable', () => {
    expect(
      deriveStatus(availableDeployment({ unavailableReplicas: 1 }), []),
    ).toEqual({ status: 'deploying', status_message: null });
  });

  it('reports deploying when the Available condition is missing', () => {
    expect(deriveStatus(createDeployment({ updatedReplicas: 1 }), [])).toEqual({
      status: 'deploying',
      status_message: null,
    });
  });

  it('reports deploying for a pending pod without a failure', () => {
    expect(
      deriveStatus(createDeployment(), [
        { status: { phase: 'Pending', containerStatuses: [] } },
      ]),
    ).toEqual({ status: 'deploying', status_message: null });
  });

  it('reports deploying while the Deployment is not available yet', () => {
    expect(
      deriveStatus(
        createDeployment({
          conditions: [{ type: 'Available', status: 'False' }],
        }),
      ),
    ).toEqual({ status: 'deploying', status_message: null });
  });
});
