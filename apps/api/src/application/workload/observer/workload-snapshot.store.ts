import type { V1Deployment, V1Pod } from '@kubernetes/client-node';
import { filter, map, Subject, type Observable } from 'rxjs';
import { WORKLOAD_ID_LABEL } from '../docker/docker-workload.manifests';

export interface WorkloadSnapshot {
  deployment?: V1Deployment;
  /**
   * Whether the absence of a Deployment is meaningful. It becomes true after
   * any Deployment event and for every entry touched by a resync; an entry
   * first created by a Pod event stays false because the Deployment informer
   * may simply not have listed it yet.
   */
  deploymentObserved: boolean;
  pods: V1Pod[];
}

/**
 * One Pod as last observed, with the moment it was observed. A delete keeps
 * the key with no Pod, so a resync list that still contains the deleted Pod
 * cannot resurrect it.
 */
interface StoredPod {
  pod?: V1Pod;
  at: number;
}

/**
 * The Deployment part and the Pods are stamped independently: a resync merges
 * both against the moment its lists started, so an event that arrived for one
 * part after that moment survives while the other part still takes the list
 * value. Pods carry their own stamp because a resync merges them one by one.
 */
interface StoredSnapshot {
  deployment?: V1Deployment;
  deploymentObserved: boolean;
  deploymentAt: number;
  pods: Map<string, StoredPod>;
  podsAt: number;
}

/**
 * The retention clock: the latest moment any part of the entry was observed.
 */
const entryObservedAt = (entry: StoredSnapshot): number =>
  Math.max(entry.deploymentAt, entry.podsAt);

/** A canonical hyphenated UUID; the only shape a workload id may have. */
const WORKLOAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when `incoming` is an older revision of the same Deployment object
 * than `current`. Resource versions are opaque to clients, but etcd hands out
 * increasing integers; when either side does not parse, nothing is ignored.
 */
const isOlderVersion = (
  incoming: V1Deployment,
  current: V1Deployment | undefined,
): boolean => {
  if (
    current === undefined ||
    incoming.metadata?.uid !== current.metadata?.uid
  ) {
    return false;
  }

  const next = Number(incoming.metadata?.resourceVersion);
  const known = Number(current.metadata?.resourceVersion);

  return Number.isInteger(next) && Number.isInteger(known) && next < known;
};

const emptyEntry = (): StoredSnapshot => ({
  deployment: undefined,
  deploymentObserved: false,
  deploymentAt: 0,
  pods: new Map<string, StoredPod>(),
  podsAt: 0,
});

/**
 * Reads the workload id from a cluster object. Everything is treated as
 * untrusted because watch events can carry malformed objects; a missing label
 * or a value that is not a canonical UUID means the object is ignored. The
 * id ends up in a SQL `IN (...)` list, so rejecting anything else here keeps
 * a stray label from failing the whole batched query.
 */
export const workloadIdOf = (resource: unknown): string | undefined => {
  if (typeof resource !== 'object' || resource === null) {
    return undefined;
  }

  const metadata = (resource as { metadata?: unknown }).metadata;

  if (typeof metadata !== 'object' || metadata === null) {
    return undefined;
  }

  const labels = (metadata as { labels?: unknown }).labels;

  if (typeof labels !== 'object' || labels === null) {
    return undefined;
  }

  const id = (labels as Record<string, unknown>)[WORKLOAD_ID_LABEL];

  return typeof id === 'string' && WORKLOAD_ID_PATTERN.test(id)
    ? id
    : undefined;
};

/**
 * In-memory view of the cluster: one entry per workload id, holding its
 * Deployment and Pods. Every applied event refreshes the observation time of
 * the part it changed. `deploymentObservedAt` exposes the Deployment part's
 * clock, which is also the observation time reported with a status. `retain`
 * drops entries the full sweep no longer backs.
 */
export class WorkloadSnapshotStore {
  private readonly workloads = new Map<string, StoredSnapshot>();
  private readonly podChanges = new Subject<string>();
  private nextGeneratedPodKey = 0;
  private listed = false;

  /**
   * True once a resync has listed the cluster. From then on the absence of an
   * entry is an answer ("no such Deployment") and not a gap in the data.
   */
  isReady(): boolean {
    return this.listed;
  }

  /**
   * Emits whenever a watch event changes one of the workload's Pods, so live
   * views (the Instances list) can refresh without waiting for a poll.
   */
  podChangesOf(id: string): Observable<void> {
    return this.podChanges.pipe(
      filter((changed) => changed === id),
      map(() => undefined),
    );
  }

  applyDeployment(
    event: 'add' | 'update' | 'delete',
    deployment: V1Deployment,
  ): void {
    const id = workloadIdOf(deployment);

    if (id === undefined) {
      return;
    }

    const current = this.workloads.get(id) ?? emptyEntry();

    // The API writes the Deployment it just applied into the snapshot, so a
    // watch event that was already in flight for the previous version must not
    // move the snapshot back.
    if (event !== 'delete' && isOlderVersion(deployment, current.deployment)) {
      return;
    }

    // A delete keeps the id with no Deployment and a fresh observation time,
    // so event-driven drift detection can see that the object is gone.
    this.workloads.set(id, {
      deployment: event === 'delete' ? undefined : deployment,
      deploymentObserved: true,
      deploymentAt: Date.now(),
      pods: current.pods,
      podsAt: current.podsAt,
    });
  }

  applyPod(event: 'add' | 'update' | 'delete', pod: V1Pod): void {
    const id = workloadIdOf(pod);

    if (id === undefined) {
      return;
    }

    const current = this.workloads.get(id) ?? emptyEntry();
    const key = this.podKey(pod);
    const at = Date.now();

    // A delete leaves a tombstone instead of dropping the key: a list request
    // that started before the delete may still return the Pod, and the merge
    // must not bring it back.
    current.pods.set(key, event === 'delete' ? { at } : { pod, at });
    current.podsAt = at;

    this.workloads.set(id, current);
    this.podChanges.next(id);
  }

  /**
   * Merges the result of one resync. `listedAt` is the moment the list
   * requests started, so anything a watch event applied after that moment is
   * newer than the list and must survive the merge. Each part is merged
   * separately: an event for the Pods does not pin a stale Deployment from
   * the list, and the reverse. Pods are merged key by key, because one fresh
   * Pod must not pin sibling Pods the list says are gone.
   *
   * The list is authoritative for every part it is not beaten on, including
   * absence: an id the list does not contain ends up with no Deployment and
   * no Pods instead of being dropped, so the status service keeps seeing the drift on
   * the event path as well as on the full sweep.
   */
  replaceAll(
    deployments: V1Deployment[],
    pods: V1Pod[],
    listedAt: number,
  ): void {
    const listedDeployments = new Map<string, V1Deployment>();

    for (const deployment of Array.isArray(deployments) ? deployments : []) {
      const id = workloadIdOf(deployment);

      if (id !== undefined) {
        listedDeployments.set(id, deployment);
      }
    }

    const listedPods = new Map<string, Map<string, V1Pod>>();

    for (const pod of Array.isArray(pods) ? pods : []) {
      const id = workloadIdOf(pod);

      if (id === undefined) {
        continue;
      }

      const bucket = listedPods.get(id) ?? new Map<string, V1Pod>();

      bucket.set(this.podKey(pod), pod);
      listedPods.set(id, bucket);
    }

    const ids = new Set([
      ...this.workloads.keys(),
      ...listedDeployments.keys(),
      ...listedPods.keys(),
    ]);

    for (const id of ids) {
      const current = this.workloads.get(id);

      let deploymentPart: Pick<
        StoredSnapshot,
        'deployment' | 'deploymentObserved' | 'deploymentAt'
      >;

      if (current !== undefined && current.deploymentAt > listedAt) {
        deploymentPart = {
          deployment: current.deployment,
          deploymentObserved: current.deploymentObserved,
          deploymentAt: current.deploymentAt,
        };
      } else {
        // No Deployment event since the list started, so the list decides,
        // including its absence: the Deployment is gone.
        deploymentPart = {
          deployment: listedDeployments.get(id),
          deploymentObserved: true,
          deploymentAt: listedAt,
        };
      }

      const storedPods = current?.pods ?? new Map<string, StoredPod>();
      const listedBucket = listedPods.get(id) ?? new Map<string, V1Pod>();
      const mergedPods = new Map<string, StoredPod>();

      // Every key the list observed gets the list value unless its own event
      // landed after the list started, and a key the list does not contain is
      // dropped: its absence at `listedAt` is authoritative.
      for (const key of new Set([
        ...storedPods.keys(),
        ...listedBucket.keys(),
      ])) {
        const stored = storedPods.get(key);

        if (stored !== undefined && stored.at > listedAt) {
          mergedPods.set(key, stored);

          continue;
        }

        const listedPod = listedBucket.get(key);

        if (listedPod !== undefined) {
          mergedPods.set(key, { pod: listedPod, at: listedAt });
        }
      }

      // The Pods were observed at the newest surviving entry, and an empty
      // merge still observed their absence at `listedAt`.
      let podsAt = listedAt;

      for (const entry of mergedPods.values()) {
        podsAt = Math.max(podsAt, entry.at);
      }

      this.workloads.set(id, { ...deploymentPart, pods: mergedPods, podsAt });
    }

    this.listed = true;
  }

  get(id: string): WorkloadSnapshot | undefined {
    const snapshot = this.workloads.get(id);

    if (snapshot === undefined) {
      return undefined;
    }

    const pods: V1Pod[] = [];

    for (const entry of snapshot.pods.values()) {
      // Tombstones carry no Pod; they only keep a deleted key from being
      // resurrected by a stale list.
      if (entry.pod !== undefined) {
        pods.push(entry.pod);
      }
    }

    return {
      deployment: snapshot.deployment,
      deploymentObserved: snapshot.deploymentObserved,
      pods,
    };
  }

  /**
   * The moment the Deployment part was last observed, or 0 when the id is
   * unknown or only Pods were seen. Deployment deletes and resyncs stamp this
   * too, so a delete observed after a user action releases the fence.
   */
  deploymentObservedAt(id: string): number {
    return this.workloads.get(id)?.deploymentAt ?? 0;
  }

  /**
   * Drops the entries the full sweep no longer backs: an id absent from the
   * database and not touched after the sweep started is a stale tombstone or
   * a workload deleted while the API was down. Every live id is kept, and so
   * is any entry observed after `before`, because that event may belong to a
   * row the sweep selected before the event landed.
   */
  retain(ids: Set<string>, before: number): void {
    for (const [id, entry] of this.workloads) {
      if (!ids.has(id) && entryObservedAt(entry) <= before) {
        this.workloads.delete(id);
      }
    }
  }

  ids(): string[] {
    return [...this.workloads.keys()];
  }

  private podKey(pod: unknown): string {
    if (typeof pod === 'object' && pod !== null) {
      const metadata = (pod as { metadata?: { uid?: unknown; name?: unknown } })
        .metadata;
      const uid = metadata?.uid;

      if (typeof uid === 'string' && uid.length > 0) {
        return uid;
      }

      const name = metadata?.name;

      if (typeof name === 'string' && name.length > 0) {
        return name;
      }
    }

    return `pod-${this.nextGeneratedPodKey++}`;
  }
}
