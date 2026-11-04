import { Injectable, Logger } from '@nestjs/common';
import {
  AppsV1Api,
  BatchV1Api,
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
  NetworkingV1Api,
  StorageV1Api,
} from '@kubernetes/client-node';
import {
  INVALID_KUBECONFIG_MESSAGE,
  readKubeConfigSource,
} from './kubeconfig-source';

@Injectable()
export class KubernetesService {
  private readonly logger = new Logger(KubernetesService.name);

  private kubeConfig?: KubeConfig;
  private coreV1Api?: CoreV1Api;
  private appsV1Api?: AppsV1Api;
  private batchV1Api?: BatchV1Api;
  private networkingV1Api?: NetworkingV1Api;
  private customObjectsApi?: CustomObjectsApi;
  private storageV1Api?: StorageV1Api;

  get config(): KubeConfig {
    if (!this.kubeConfig) {
      const kubeConfig = this.loadKubeConfig();
      this.logger.log(
        `Using Kubernetes context "${kubeConfig.getCurrentContext()}"`,
      );
      this.kubeConfig = kubeConfig;
    }

    return this.kubeConfig;
  }

  private loadKubeConfig(): KubeConfig {
    const kubeConfigSource = process.env.KUBECONFIG;

    if (!kubeConfigSource) {
      const kubeConfig = new KubeConfig();
      kubeConfig.loadFromDefault();
      return kubeConfig;
    }

    const kubeConfig = new KubeConfig();
    const kubeConfigData = readKubeConfigSource(kubeConfigSource);

    try {
      kubeConfig.loadFromString(kubeConfigData);
    } catch {
      throw new Error(INVALID_KUBECONFIG_MESSAGE);
    }

    if (kubeConfig.clusters.length === 0) {
      throw new Error(INVALID_KUBECONFIG_MESSAGE);
    }

    return kubeConfig;
  }

  get coreV1(): CoreV1Api {
    return (this.coreV1Api ??= this.config.makeApiClient(CoreV1Api));
  }

  get appsV1(): AppsV1Api {
    return (this.appsV1Api ??= this.config.makeApiClient(AppsV1Api));
  }

  get batchV1(): BatchV1Api {
    return (this.batchV1Api ??= this.config.makeApiClient(BatchV1Api));
  }

  get networkingV1(): NetworkingV1Api {
    return (this.networkingV1Api ??=
      this.config.makeApiClient(NetworkingV1Api));
  }

  get customObjects(): CustomObjectsApi {
    return (this.customObjectsApi ??=
      this.config.makeApiClient(CustomObjectsApi));
  }

  get storageV1(): StorageV1Api {
    return (this.storageV1Api ??= this.config.makeApiClient(StorageV1Api));
  }
}
