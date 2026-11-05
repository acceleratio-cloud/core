import { Injectable } from '@nestjs/common';
import {
  makeInformer,
  type Informer,
  type V1Deployment,
  type V1Pod,
} from '@kubernetes/client-node';
import { KubernetesService } from './kubernetes.service';

// Cluster-wide list and watch paths. They stay here so the application layer
// only passes label selectors and never builds Kubernetes URLs itself.
const DEPLOYMENTS_PATH = '/apis/apps/v1/deployments';
const PODS_PATH = '/api/v1/pods';

@Injectable()
export class KubernetesWatchService {
  constructor(private readonly kubernetes: KubernetesService) {}

  createDeploymentInformer(labelSelector: string): Informer<V1Deployment> {
    return makeInformer(
      this.kubernetes.config,
      DEPLOYMENTS_PATH,
      () =>
        this.kubernetes.appsV1.listDeploymentForAllNamespaces({
          labelSelector,
        }),
      labelSelector,
    );
  }

  createPodInformer(labelSelector: string): Informer<V1Pod> {
    return makeInformer(
      this.kubernetes.config,
      PODS_PATH,
      () => this.kubernetes.coreV1.listPodForAllNamespaces({ labelSelector }),
      labelSelector,
    );
  }

  async listDeployments(labelSelector: string): Promise<V1Deployment[]> {
    const list = await this.kubernetes.appsV1.listDeploymentForAllNamespaces({
      labelSelector,
    });

    return list.items ?? [];
  }

  async listPods(labelSelector: string): Promise<V1Pod[]> {
    const list = await this.kubernetes.coreV1.listPodForAllNamespaces({
      labelSelector,
    });

    return list.items ?? [];
  }
}
