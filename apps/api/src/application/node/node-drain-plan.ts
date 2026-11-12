import type {
  V1LabelSelector,
  V1Node,
  V1PersistentVolume,
  V1Pod,
  V1PodDisruptionBudget,
} from '@kubernetes/client-node';
import type {
  NodeDrainPlan,
  NodeDrainPod,
  NodeStorageRisk,
} from '@acceleratio/shared';
import { longhornNamespace } from '@/vendor/kubernetes/longhorn';

/** The emptyDir a static site's pods fill from RustFS on every start. */
const REBUILT_VOLUME = 'files';
const WORKLOAD_ID_LABEL = 'acceleratio.io/workload-id';
const CONTROL_PLANE_LABELS = [
  'node-role.kubernetes.io/control-plane',
  'node-role.kubernetes.io/master',
];

export interface DrainPlanInput {
  node: string;
  nodes: V1Node[];
  /** Pods scheduled on `node`. */
  pods: V1Pod[];
  budgets: V1PodDisruptionBudget[];
  volumes: V1PersistentVolume[];
  /** `replicas.longhorn.io` of every node; empty without Longhorn. */
  longhornReplicas: LonghornReplica[];
  /** `volumes.longhorn.io`, to name a volume by its claim. */
  longhornVolumes: LonghornVolume[];
}

export interface LonghornReplica {
  spec?: {
    volumeName?: string;
    nodeID?: string;
    healthyAt?: string;
    failedAt?: string;
  };
}

export interface LonghornVolume {
  metadata?: { name?: string };
  status?: { kubernetesStatus?: { namespace?: string; pvcName?: string } };
}

export const isControlPlane = (node: V1Node): boolean =>
  CONTROL_PLANE_LABELS.some(
    (label) => node.metadata?.labels?.[label] !== undefined,
  );

export const selectorMatches = (
  selector: V1LabelSelector | undefined,
  labels: Record<string, string>,
): boolean => {
  // An empty selector matches every pod of the namespace; a missing one none.
  if (!selector) {
    return false;
  }

  for (const [key, value] of Object.entries(selector.matchLabels ?? {})) {
    if (labels[key] !== value) {
      return false;
    }
  }

  return (selector.matchExpressions ?? []).every((expression) => {
    const value = labels[expression.key];
    const values = expression.values ?? [];

    switch (expression.operator) {
      case 'In':
        return value !== undefined && values.includes(value);
      case 'NotIn':
        return value === undefined || !values.includes(value);
      case 'Exists':
        return value !== undefined;
      case 'DoesNotExist':
        return value === undefined;
      default:
        return false;
    }
  });
};

const isFinished = (pod: V1Pod): boolean =>
  pod.status?.phase === 'Succeeded' || pod.status?.phase === 'Failed';

const isDaemonSetPod = (pod: V1Pod): boolean =>
  pod.metadata?.ownerReferences?.some((owner) => owner.kind === 'DaemonSet') ??
  false;

const isMirrorPod = (pod: V1Pod): boolean =>
  pod.metadata?.annotations?.['kubernetes.io/config.mirror'] !== undefined;

const hasController = (pod: V1Pod): boolean =>
  pod.metadata?.ownerReferences?.some((owner) => owner.controller) ?? false;

const hasLocalData = (pod: V1Pod): boolean =>
  (pod.spec?.volumes ?? []).some(
    (volume) =>
      (volume.emptyDir !== undefined &&
        volume.emptyDir.medium !== 'Memory' &&
        // A static site copies its files in again wherever it starts.
        !(
          volume.name === REBUILT_VOLUME &&
          pod.metadata?.labels?.[WORKLOAD_ID_LABEL] !== undefined
        )) ||
      volume.hostPath !== undefined,
  );

const isBlockedByBudget = (
  pod: V1Pod,
  budgets: V1PodDisruptionBudget[],
): boolean =>
  budgets.some(
    (budget) =>
      budget.metadata?.namespace === pod.metadata?.namespace &&
      (budget.status?.disruptionsAllowed ?? 0) < 1 &&
      selectorMatches(budget.spec?.selector, pod.metadata?.labels ?? {}),
  );

const classify = (
  pod: V1Pod,
  budgets: V1PodDisruptionBudget[],
): NodeDrainPod => {
  const base = {
    namespace: pod.metadata?.namespace ?? '',
    name: pod.metadata?.name ?? '',
    pdb_blocked: false,
  };

  if (isFinished(pod)) {
    return { ...base, action: 'skip', reason: 'Pod already finished' };
  }

  if (isDaemonSetPod(pod)) {
    return { ...base, action: 'skip', reason: 'Managed by a DaemonSet' };
  }

  if (isMirrorPod(pod)) {
    return { ...base, action: 'skip', reason: 'Static pod' };
  }

  // Longhorn's own pods (instance managers) hold no data of their own and are
  // recreated by Longhorn. Their budgets hold the eviction until Longhorn has
  // moved the replicas they serve, so they are evicted like any other pod.
  if (pod.metadata?.namespace === longhornNamespace()) {
    return {
      ...base,
      action: 'evict',
      reason: null,
      pdb_blocked: isBlockedByBudget(pod, budgets),
    };
  }

  if (!hasController(pod)) {
    return {
      ...base,
      action: 'blocked',
      reason: 'No controller will recreate this pod',
    };
  }

  if (hasLocalData(pod)) {
    return {
      ...base,
      action: 'blocked',
      reason: 'Uses local data (emptyDir or hostPath)',
    };
  }

  return {
    ...base,
    action: 'evict',
    reason: null,
    pdb_blocked: isBlockedByBudget(pod, budgets),
  };
};

const pinsToNode = (volume: V1PersistentVolume, node: string): boolean => {
  if (volume.spec?.local !== undefined || volume.spec?.hostPath !== undefined) {
    const terms = volume.spec?.nodeAffinity?.required?.nodeSelectorTerms ?? [];

    // Without affinity a hostPath volume belongs to whichever node runs the pod.
    return (
      terms.length === 0 ||
      terms.some((term) =>
        (term.matchExpressions ?? []).some(
          (expression) =>
            expression.key === 'kubernetes.io/hostname' &&
            (expression.values ?? []).includes(node),
        ),
      )
    );
  }

  return (volume.spec?.nodeAffinity?.required?.nodeSelectorTerms ?? []).some(
    (term) =>
      (term.matchExpressions ?? []).some(
        (expression) =>
          expression.key === 'kubernetes.io/hostname' &&
          (expression.values ?? []).includes(node),
      ),
  );
};

const storageRisks = (input: DrainPlanInput): NodeStorageRisk[] => {
  const risks: NodeStorageRisk[] = [];
  const claimsOnNode = new Set(
    input.pods.flatMap((pod) =>
      (pod.spec?.volumes ?? [])
        .map((volume) => volume.persistentVolumeClaim?.claimName)
        .filter((claim): claim is string => Boolean(claim))
        .map((claim) => `${pod.metadata?.namespace}/${claim}`),
    ),
  );

  for (const volume of input.volumes) {
    const claim = volume.spec?.claimRef;
    const key = `${claim?.namespace}/${claim?.name}`;

    if (
      claim &&
      pinsToNode(volume, input.node) &&
      (claimsOnNode.has(key) ||
        volume.spec?.nodeAffinity !== undefined ||
        volume.spec?.local !== undefined)
    ) {
      risks.push({
        kind: 'persistent_volume',
        namespace: claim.namespace ?? null,
        name: claim.name ?? volume.metadata?.name ?? '',
        reason: 'Volume data is stored only on this node',
      });
    }
  }

  const healthy = input.longhornReplicas.filter(
    (replica) => replica.spec?.healthyAt && !replica.spec?.failedAt,
  );
  const claims = new Map(
    input.longhornVolumes.map((volume) => [
      volume.metadata?.name ?? '',
      volume.status?.kubernetesStatus,
    ]),
  );

  for (const volume of new Set(
    healthy
      .filter((replica) => replica.spec?.nodeID === input.node)
      .map((replica) => replica.spec?.volumeName ?? ''),
  )) {
    const elsewhere = healthy.some(
      (replica) =>
        replica.spec?.volumeName === volume &&
        replica.spec?.nodeID !== input.node,
    );

    if (volume && !elsewhere) {
      const claim = claims.get(volume);

      risks.push({
        kind: 'longhorn_replica',
        namespace: claim?.namespace ?? null,
        name: claim?.pvcName ?? volume,
        reason:
          'The only healthy copy of this volume is on this server. A drain first copies it to another server with free space and waits until the copy is complete.',
      });
    }
  }

  return risks;
};

export const buildDrainPlan = (input: DrainPlanInput): NodeDrainPlan => {
  const pods = input.pods.map((pod) => classify(pod, input.budgets));
  const storage = storageRisks(input);
  const node = input.nodes.find((item) => item.metadata?.name === input.node);
  const drainBlockers: string[] = [];
  const deleteBlockers: string[] = [];

  for (const pod of pods.filter((item) => item.action === 'blocked')) {
    drainBlockers.push(`${pod.namespace}/${pod.name}: ${pod.reason}`);
  }

  if (input.nodes.length <= 1) {
    deleteBlockers.push('This is the only server in the cluster');
  }

  if (
    node &&
    isControlPlane(node) &&
    input.nodes.filter(isControlPlane).length <= 1
  ) {
    deleteBlockers.push('This is the last control plane node');
  }

  // A Longhorn copy moves during the drain that precedes a removal, but
  // only while the node is up: from a node that is down nothing can copy it.
  const ready = node?.status?.conditions?.some(
    (condition) => condition.type === 'Ready' && condition.status === 'True',
  );

  for (const risk of storage.filter(
    (item) => item.kind === 'persistent_volume' || !ready,
  )) {
    deleteBlockers.push(
      `${risk.namespace ? `${risk.namespace}/` : ''}${risk.name}: ${risk.reason}`,
    );
  }

  return {
    node: input.node,
    pods,
    drain_blockers: drainBlockers,
    delete_blockers: deleteBlockers,
    storage,
  };
};
