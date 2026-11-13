/**
 * Private network between the services of a project, against a real cluster.
 *
 * Runs only with CLUSTER_E2E=1 and a KUBECONFIG that points at a disposable
 * cluster with Cilium (a `scripts/install.sh --dev` server, then
 * `bun run test:cluster`). It uses
 * the API's own isolation, DNS and Service code, never a copy of it:
 *
 * - project A runs PostgreSQL as `db` (plus a plain TCP listener on 9000, a
 *   port nothing declares), with the headless Service of a Docker service;
 * - a pod in A connects to `db.internal:5432` and `db.internal:9000`;
 * - a pod in B cannot resolve `db.internal`, and cannot connect to A's pod
 *   even through the cluster FQDN, which does resolve.
 *
 * Runs under Node's test runner: the Kubernetes client is ESM-only, which the
 * Jest setup of this package does not load, and Bun's fetch ignores the
 * client certificate of a kubeconfig.
 */
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { V1Job } from '@kubernetes/client-node';
import { ProjectDnsService } from '@/application/project/project-dns.service';
import { ProjectIsolationService } from '@/application/project/project-isolation.service';
import { buildInternalService } from '@/application/workload/docker/docker-workload-network.manifests';
import {
  PROJECT_ID_LABEL,
  WORKLOAD_ID_LABEL,
} from '@/application/workload/docker/docker-workload.manifests';
import { projectNamespace } from '@/common/naming';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';

const enabled = process.env.CLUSTER_E2E === '1';
const IMAGE = process.env.CLUSTER_E2E_POSTGRES_IMAGE ?? 'postgres:17-alpine';
const JOB_TIMEOUT_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

void describe('project private network (cluster)', { skip: !enabled }, () => {
  const kubernetes = new KubernetesService();
  const dns = new ProjectDnsService(kubernetes);
  const isolation = new ProjectIsolationService(kubernetes, dns);
  const projectA = randomUUID();
  const projectB = randomUUID();
  const workloadId = randomUUID();
  const namespaceA = projectNamespace(projectA);
  const namespaceB = projectNamespace(projectB);
  const fqdn = `db.${namespaceA}.svc.cluster.local`;

  /** Runs a one-shot pod and resolves with its exit code and log. */
  const runJob = async (
    namespace: string,
    name: string,
    script: string,
  ): Promise<{ succeeded: boolean; log: string }> => {
    const body: V1Job = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name, namespace },
      spec: {
        backoffLimit: 0,
        ttlSecondsAfterFinished: 600,
        template: {
          metadata: { labels: { 'job-name': name } },
          spec: {
            restartPolicy: 'Never',
            containers: [
              {
                name: 'check',
                image: IMAGE,
                command: ['sh', '-c', script],
              },
            ],
          },
        },
      },
    };

    await kubernetes.batchV1.createNamespacedJob({ namespace, body });

    const deadline = Date.now() + JOB_TIMEOUT_MS;
    let status: V1Job['status'];

    while (Date.now() < deadline) {
      status = (await kubernetes.batchV1.readNamespacedJob({ name, namespace }))
        .status;

      if (status?.succeeded || status?.failed) {
        break;
      }

      await sleep(2000);
    }

    const pods = await kubernetes.coreV1.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${name}`,
    });
    const pod = pods.items[0]?.metadata?.name;
    const log = pod
      ? await kubernetes.coreV1.readNamespacedPodLog({ name: pod, namespace })
      : '';

    if (!status?.succeeded && !status?.failed) {
      throw new Error(`Job ${namespace}/${name} did not finish:\n${log}`);
    }

    return { succeeded: Boolean(status.succeeded), log };
  };

  before(async () => {
    await isolation.ensure(projectA);
    await isolation.ensure(projectB);

    const labels = {
      [WORKLOAD_ID_LABEL]: workloadId,
      [PROJECT_ID_LABEL]: projectA,
    };

    await kubernetes.appsV1.createNamespacedDeployment({
      namespace: namespaceA,
      body: {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'db-e2e', namespace: namespaceA, labels },
        spec: {
          replicas: 1,
          selector: { matchLabels: { [WORKLOAD_ID_LABEL]: workloadId } },
          template: {
            metadata: { labels },
            spec: {
              containers: [
                {
                  name: 'postgres',
                  image: IMAGE,
                  env: [{ name: 'POSTGRES_PASSWORD', value: 'e2e' }],
                  readinessProbe: {
                    exec: { command: ['pg_isready', '-U', 'postgres'] },
                    periodSeconds: 2,
                  },
                },
                {
                  // A port that no Service or manifest declares.
                  name: 'echo',
                  image: IMAGE,
                  command: [
                    'sh',
                    '-c',
                    'while true; do echo pong | nc -l -p 9000; done',
                  ],
                },
              ],
            },
          },
        },
      },
    });

    await kubernetes.coreV1.createNamespacedService({
      namespace: namespaceA,
      body: buildInternalService(
        { id: workloadId, project_id: projectA, external_name: 'db-e2e' },
        'db',
      ),
    });
  });

  after(async () => {
    await Promise.allSettled([
      isolation.remove(projectA),
      isolation.remove(projectB),
    ]);
  });

  void it('connects to a neighbour by its private name on any port', async () => {
    // CoreDNS picks up a new rule within a minute or two, so the first
    // lookups may still miss; keep trying for a while.
    const { succeeded, log } = await runJob(
      namespaceA,
      'reach-db',
      [
        'for i in $(seq 1 90); do',
        '  if pg_isready -h db.internal -p 5432 -t 2 &&',
        '     [ "$(echo ping | nc -w 3 db.internal 9000)" = pong ]; then',
        '    echo reachable; exit 0',
        '  fi',
        '  sleep 2',
        'done',
        'exit 1',
      ].join('\n'),
    );

    assert.ok(succeeded, log);
    assert.match(log, /reachable/);
  });

  void it('is unreachable from another project', async () => {
    const { succeeded, log } = await runJob(
      namespaceB,
      'reach-other-project',
      [
        // The private name is scoped to the asking project.
        'if getent hosts db.internal; then echo "db.internal resolved"; exit 1; fi',
        // The cluster name resolves, so a failure below is the policy.
        `getent hosts ${fqdn} || { echo "${fqdn} did not resolve"; exit 1; }`,
        'for i in 1 2 3 4 5; do',
        `  if pg_isready -h ${fqdn} -p 5432 -t 3; then echo "connected"; exit 1; fi`,
        `  if echo ping | nc -w 3 ${fqdn} 9000 | grep -q pong; then echo "connected 9000"; exit 1; fi`,
        'done',
        'echo isolated',
      ].join('\n'),
    );

    assert.ok(succeeded, log);
    assert.match(log, /isolated/);
  });
});
