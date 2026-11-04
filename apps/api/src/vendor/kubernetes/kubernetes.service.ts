import http from 'node:http';
import https from 'node:https';
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
import type { ServiceProxyRequest, ServiceTarget } from './service-proxy';

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

  /**
   * Sends one request to a cluster-internal Service through the API server's
   * service proxy and resolves once the response headers arrive. The API runs
   * outside the cluster in development and these Services have no exposed
   * port; the proxy reuses the kubeconfig credentials the API already holds.
   * The caller reads or pipes the body and must consume it.
   */
  async proxyServiceRequest(
    target: ServiceTarget,
    input: ServiceProxyRequest,
  ): Promise<http.IncomingMessage> {
    const cluster = this.config.getCurrentCluster();

    if (!cluster) {
      throw new Error('The kubeconfig has no current cluster');
    }

    const { service, namespace, port } = target;
    const url = new URL(
      `${cluster.server.replace(/\/+$/, '')}/api/v1/namespaces/${namespace}/services/${service}:${port}/proxy${input.path}`,
    );

    for (const [key, value] of Object.entries(input.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const options: https.RequestOptions = {
      method: input.method,
      headers: { ...input.headers },
    };

    // Adds the client certificate, CA, token or exec credentials.
    await this.config.applyToHTTPSOptions(options);

    const transport = url.protocol === 'http:' ? http : https;

    return new Promise((resolve, reject) => {
      const request = transport.request(url, options, resolve);

      request.on('error', reject);

      if (input.timeoutMs !== undefined) {
        request.setTimeout(input.timeoutMs, () => {
          request.destroy(
            new Error(
              `Service proxy request timed out after ${input.timeoutMs}ms`,
            ),
          );
        });
      }

      if (input.body === undefined) {
        request.end();
      } else if (Buffer.isBuffer(input.body)) {
        request.end(input.body);
      } else if (typeof input.body === 'function') {
        input.body(request);
      } else {
        input.body.on('error', (error) => request.destroy(error));
        input.body.pipe(request);
      }
    });
  }
}
