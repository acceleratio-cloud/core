import type {
  V1ContainerStatus,
  V1Deployment,
  V1DeploymentCondition,
  V1Pod,
} from '@kubernetes/client-node';
import { deriveStatus } from '../docker-workload.status';

const createDeployment = (
  options: {
    replicas?: number;
    conditions?: V1DeploymentCondition[];
  } = {},
): V1Deployment => ({
  metadata: { name: 'my-api' },
  spec: {
    replicas: options.replicas ?? 1,
    selector: { matchLabels: {} },
    template: {},
  },
  status: { conditions: options.conditions },
});

const containerStatus = (
  reason: string,
  message?: string,
): V1ContainerStatus => ({
  name: 'main',
  image: 'nginx:1.25',
  imageID: '',
  ready: false,
  restartCount: 0,
  state: { waiting: { reason, message } },
});

const createPod = (
  reason: string,
  message?: string,
  initContainer = false,
): V1Pod => ({
  metadata: { labels: {} },
  status: initContainer
    ? { initContainerStatuses: [containerStatus(reason, message)] }
    : { containerStatuses: [containerStatus(reason, message)] },
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
        createPod('CrashLoopBackOff', 'back-off restarting'),
      ]),
    ).toEqual({ status: 'stopped', status_message: null });
  });

  it('reports running when the Available condition is True', () => {
    expect(
      deriveStatus(
        createDeployment({
          conditions: [{ type: 'Available', status: 'True' }],
        }),
      ),
    ).toEqual({ status: 'running', status_message: null });
  });

  it('lets Available win over a failing pod', () => {
    expect(
      deriveStatus(
        createDeployment({
          conditions: [{ type: 'Available', status: 'True' }],
        }),
        [createPod('ImagePullBackOff')],
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

  it.each([
    'ImagePullBackOff',
    'ErrImagePull',
    'InvalidImageName',
    'CrashLoopBackOff',
    'CreateContainerConfigError',
  ])('reports failed for a pod in %s', (reason) => {
    expect(deriveStatus(createDeployment(), [createPod(reason)])).toEqual({
      status: 'failed',
      status_message: reason,
    });
  });

  it('includes the container message in status_message', () => {
    expect(
      deriveStatus(createDeployment(), [
        createPod('ImagePullBackOff', 'Back-off pulling image "nginx:9"'),
      ]),
    ).toEqual({
      status: 'failed',
      status_message: 'ImagePullBackOff: Back-off pulling image "nginx:9"',
    });
  });

  it('inspects init container failures too', () => {
    expect(
      deriveStatus(createDeployment(), [
        createPod('CreateContainerConfigError', 'secret not found', true),
      ]),
    ).toEqual({
      status: 'failed',
      status_message: 'CreateContainerConfigError: secret not found',
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
