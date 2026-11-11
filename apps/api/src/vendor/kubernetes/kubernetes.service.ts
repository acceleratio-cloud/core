import http from 'node:http';
import https from 'node:https';
import { PassThrough, Writable, type Readable } from 'node:stream';
import { Injectable, Logger } from '@nestjs/common';
import {
  AppsV1Api,
  BatchV1Api,
  CoreV1Api,
  CustomObjectsApi,
  Exec,
  KubeConfig,
  NetworkingV1Api,
  PolicyV1Api,
  StorageV1Api,
} from '@kubernetes/client-node';
import type { V1Status } from '@kubernetes/client-node';
import {
  INVALID_KUBECONFIG_MESSAGE,
  readKubeConfigSource,
} from './kubeconfig-source';
import type { ServiceProxyRequest, ServiceTarget } from './service-proxy';

/** Options of an interactive command inside a Pod container. */
/** runInPod's error when the command outlives `timeoutMs`; it may still be running. */
export const COMMAND_TIMED_OUT = 'Command timed out';

export interface PodExecRequest {
  namespace: string;
  pod: string;
  container: string;
  command: string[];
  /** Receives stdout and stderr; give it `columns`/`rows` and emit `resize` to size the TTY. */
  output: Writable;
  input: Readable;
  /** Called once with the command's final status (exit code, failure). */
  onStatus: (status: V1Status) => void;
}

/** The Kubernetes side of an exec session; closing it ends the command. */
export interface PodExecConnection {
  close(): void;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

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
  private policyV1Api?: PolicyV1Api;

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

  /**
   * Runs a command with a TTY inside a Pod container over the Kubernetes exec
   * WebSocket. Resolves once the stream is open.
   */
  async execInPod(request: PodExecRequest): Promise<PodExecConnection> {
    return new Exec(this.config).exec(
      request.namespace,
      request.pod,
      request.container,
      request.command,
      request.output,
      request.output,
      request.input,
      true,
      request.onStatus,
    );
  }

  /**
   * Runs a command without a TTY and returns its stdout. Rejects with the
   * command's stderr when it exits non-zero, and closes it once `timeoutMs`
   * passes or stdout grows past `maxBytes`. `stdin` is sent to the command
   * and closed when it ends.
   */
  async runInPod(request: {
    namespace: string;
    pod: string;
    container: string;
    command: string[];
    timeoutMs: number;
    maxBytes: number;
    stdin?: Readable;
  }): Promise<string> {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let fail: (error: Error) => void = () => undefined;
    const sink = (chunks: Buffer[], limited: boolean) =>
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          size += limited ? chunk.length : 0;

          if (size > request.maxBytes) {
            fail(new Error('Command output is too large'));
          } else {
            chunks.push(chunk);
          }

          callback();
        },
      });

    return new Promise<string>((resolve, reject) => {
      let socket: { close(): void } | undefined;
      const timer = setTimeout(
        () => fail(new Error(COMMAND_TIMED_OUT)),
        request.timeoutMs,
      );
      const settle = () => {
        clearTimeout(timer);
        socket?.close();
      };

      fail = (error) => {
        settle();
        reject(error);
      };

      new Exec(this.config)
        .exec(
          request.namespace,
          request.pod,
          request.container,
          request.command,
          sink(stdout, true),
          sink(stderr, false),
          request.stdin ?? null,
          false,
          (status) => {
            settle();

            if (status.status === 'Success') {
              resolve(Buffer.concat(stdout).toString('utf8'));
            } else {
              reject(
                new Error(
                  Buffer.concat(stderr).toString('utf8').trim() ||
                    status.message ||
                    'Command failed',
                ),
              );
            }
          },
        )
        .then((opened) => {
          socket = opened;
        })
        .catch(fail);
    });
  }

  /**
   * Runs a command without a TTY and streams its stdout. The stream fails
   * with the command's stderr when it exits non-zero; destroying the stream
   * ends the command. shortcut: exec writes ignore backpressure, so a slow
   * reader buffers output in memory; fine for downloads to a browser.
   */
  streamFromPod(request: {
    namespace: string;
    pod: string;
    container: string;
    command: string[];
  }): Readable {
    const stdout = new PassThrough();
    const stderr: Buffer[] = [];
    let socket: { close(): void } | undefined;

    stdout.on('close', () => socket?.close());

    new Exec(this.config)
      .exec(
        request.namespace,
        request.pod,
        request.container,
        request.command,
        stdout,
        new Writable({
          write(chunk: Buffer, _encoding, callback) {
            if (stderr.length < 64) {
              stderr.push(chunk);
            }

            callback();
          },
        }),
        null,
        false,
        (status) => {
          if (status.status === 'Success') {
            stdout.end();
          } else {
            stdout.destroy(
              new Error(
                Buffer.concat(stderr).toString('utf8').trim() ||
                  status.message ||
                  'Command failed',
              ),
            );
          }
        },
      )
      .then((opened) => {
        socket = opened;

        if (stdout.destroyed) {
          opened.close();
        }
      })
      .catch((error: Error) => stdout.destroy(error));

    return stdout;
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

  get policyV1(): PolicyV1Api {
    return (this.policyV1Api ??= this.config.makeApiClient(PolicyV1Api));
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
