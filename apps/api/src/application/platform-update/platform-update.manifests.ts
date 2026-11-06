import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { V1Job } from '@kubernetes/client-node';

export const UPDATE_ID_LABEL = 'acceleratio.io/platform-update-id';
export const LAUNCHER_CONTAINER = 'launcher';
/** Where the runner keeps its work directory on the server. */
export const DEFAULT_UPDATE_ROOT = '/var/lib/acceleratio/updates';
export const DEFAULT_CONFIG_DIR = '/etc/acceleratio';
/** The launcher only hands the update to systemd; it never runs for long. */
export const LAUNCHER_DEADLINE_SECONDS = 300;
/** A finished launcher Job is removed by Kubernetes after a day. */
export const LAUNCHER_TTL_SECONDS = 24 * 60 * 60;

const SCRIPTS_DIR = join(__dirname, 'scripts');

let scripts: { launcher: string; runner: string } | null = null;

/** The launcher (runs in the Job) and the runner (runs on the server). */
export const readUpdateScripts = (): { launcher: string; runner: string } =>
  (scripts ??= {
    launcher: readFileSync(join(SCRIPTS_DIR, 'launcher.sh'), 'utf8'),
    runner: readFileSync(join(SCRIPTS_DIR, 'runner.sh'), 'utf8'),
  });

/** Job and status ConfigMap name of an update: a DNS label. */
export const updateExternalName = (id: string): string =>
  `platform-update-${id.replace(/-/g, '').slice(0, 12)}`;

export interface UpdateJobInput {
  id: string;
  name: string;
  namespace: string;
  /** Image with a shell and nsenter: the API's own image. */
  image: string;
  /** The server that holds the installation. */
  nodeName: string | null;
  targetVersion: string;
  releaseUrl: string;
  updateSha256: string;
  installSha256: string;
  configDir: string;
  updateRoot: string;
}

/**
 * A privileged, host-PID Job pinned to the installation's server. It writes
 * the runner to the host and starts it as a transient systemd unit, then
 * exits: the update itself never depends on this Pod.
 */
export const buildUpdateJob = (input: UpdateJobInput): V1Job => {
  const { launcher, runner } = readUpdateScripts();
  const labels = {
    'app.kubernetes.io/name': 'platform-update',
    'app.kubernetes.io/part-of': 'acceleratio',
    'app.kubernetes.io/managed-by': 'acceleratio',
    [UPDATE_ID_LABEL]: input.id,
  };
  const env: Record<string, string> = {
    UPDATE_ID: input.id,
    UPDATE_ROOT: input.updateRoot,
    CONFIG_DIR: input.configDir,
    TARGET_VERSION: input.targetVersion,
    RELEASE_URL: input.releaseUrl,
    UPDATE_SHA256: input.updateSha256,
    INSTALL_SHA256: input.installSha256,
    STATUS_NAMESPACE: input.namespace,
    STATUS_CONFIGMAP: input.name,
    RUNNER_SCRIPT: runner,
  };

  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: input.name, namespace: input.namespace, labels },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: LAUNCHER_DEADLINE_SECONDS,
      ttlSecondsAfterFinished: LAUNCHER_TTL_SECONDS,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: 'Never',
          hostPID: true,
          automountServiceAccountToken: false,
          ...(input.nodeName
            ? { nodeName: input.nodeName }
            : {
                nodeSelector: {
                  'node-role.kubernetes.io/control-plane': 'true',
                },
              }),
          // The server may be cordoned or tainted; the update must still run.
          tolerations: [{ operator: 'Exists' }],
          containers: [
            {
              name: LAUNCHER_CONTAINER,
              image: input.image,
              imagePullPolicy: 'IfNotPresent',
              command: ['/bin/sh', '-c', launcher],
              env: Object.entries(env).map(([name, value]) => ({
                name,
                value,
              })),
              securityContext: {
                privileged: true,
                runAsUser: 0,
                runAsGroup: 0,
              },
              resources: {
                requests: { cpu: '10m', memory: '16Mi' },
                limits: { memory: '64Mi' },
              },
            },
          ],
        },
      },
    },
  };
};
