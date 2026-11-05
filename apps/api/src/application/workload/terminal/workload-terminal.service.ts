import { STATUS_CODES, type IncomingMessage, type Server } from 'node:http';
import { PassThrough, Writable } from 'node:stream';
import type { Duplex } from 'node:stream';
import {
  HttpException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { V1Pod, V1Status } from '@kubernetes/client-node';
import type {
  WorkloadTerminalClientMessage,
  WorkloadTerminalServerMessage,
} from '@acceleratio/shared';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { projectNamespace } from '@/common/naming';
import { getKubernetesStatusCode } from '@/vendor/kubernetes/kubernetes-error';
import {
  KubernetesService,
  type PodExecConnection,
} from '@/vendor/kubernetes/kubernetes.service';
import { isTrustedOrigin } from '@/vendor/auth/trusted-origins';
import {
  CONTAINER_NAME,
  WORKLOAD_ID_LABEL,
} from '../docker/docker-workload.manifests';
import { WorkloadInstancesService } from '../instances/workload-instances.service';
import {
  isTerminalPath,
  parseTerminalRequest,
  toDimension,
  type TerminalRequest,
} from './terminal-request';

/** Prefers bash, falls back to sh; TERM matches the console's xterm.js. */
export const TERMINAL_COMMAND = [
  '/bin/sh',
  '-c',
  'export TERM=xterm-256color; if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi',
];
export const MAX_SESSIONS_PER_USER = 20;
export const PING_INTERVAL_MS = 30_000;
/** Keystrokes and pastes; generous, but bounded. */
const MAX_PAYLOAD_BYTES = 1024 * 1024;
const CLOSE_NORMAL = 1000;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_INTERNAL_ERROR = 1011;

class UpgradeRejection extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface AuthorizedTarget extends TerminalRequest {
  namespace: string;
  userId: string;
}

/**
 * The TTY the exec stream writes into. `columns`/`rows` plus `resize` make
 * the Kubernetes client forward size changes on the resize channel.
 */
class TerminalOutput extends Writable {
  constructor(
    private readonly socket: WebSocket,
    public columns: number,
    public rows: number,
  ) {
    super();
  }

  resize(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) {
      return;
    }

    this.columns = columns;
    this.rows = rows;
    this.emit('resize');
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      callback();
      return;
    }

    // Waiting for the send applies backpressure to a chatty command.
    this.socket.send(chunk, { binary: true }, () => callback());
  }
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toBuffer = (data: RawData): Buffer =>
  Buffer.isBuffer(data)
    ? data
    : Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.from(data);

/** The exit code Kubernetes reports in the exec status, if any. */
export const exitCodeOf = (status: V1Status): number | null => {
  if (status.status === 'Success') {
    return 0;
  }

  const cause = status.details?.causes?.find(
    (item) => item.reason === 'ExitCode',
  );
  const code = cause?.message === undefined ? NaN : Number(cause.message);

  return Number.isInteger(code) ? code : null;
};

/** Answers a refused upgrade with a plain HTTP response and drops the socket. */
const reject = (socket: Duplex, status: number, message: string): void => {
  if (socket.writable) {
    const body = Buffer.from(message, 'utf8');

    socket.write(
      `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Error'}\r\n` +
        'Connection: close\r\n' +
        'Content-Type: text/plain; charset=utf-8\r\n' +
        `Content-Length: ${body.length}\r\n\r\n`,
    );
    socket.end(body);
    return;
  }

  socket.destroy();
};

const parseControl = (text: string): WorkloadTerminalClientMessage | null => {
  try {
    const value = JSON.parse(text) as Partial<WorkloadTerminalClientMessage>;

    return value?.type === 'resize'
      ? (value as WorkloadTerminalClientMessage)
      : null;
  } catch {
    return null;
  }
};

/**
 * Interactive shells into Docker service instances. The browser opens a
 * WebSocket on `/projects/:projectId/workloads/:id/instances/:pod/terminal`;
 * the upgrade is authorized here (trusted Origin, better-auth session, a
 * running Pod of that workload), then bridged to the Kubernetes exec stream.
 * Binary frames carry terminal bytes; text frames carry JSON control
 * messages (`resize` in, `exit`/`error` out).
 */
@Injectable()
export class WorkloadTerminalService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(WorkloadTerminalService.name);
  private readonly sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
  });
  /** Open sessions and their user, for the per-user cap and shutdown. */
  private readonly sessions = new Map<WebSocket, string>();
  private httpServer?: Server;

  private readonly onUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    void this.handleUpgrade(request, socket, head);
  };

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly authService: AuthService,
    private readonly instances: WorkloadInstancesService,
    private readonly kubernetes: KubernetesService,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter?.getHttpServer() as
      Server | undefined;

    if (!server) {
      return;
    }

    this.httpServer = server;
    server.on('upgrade', this.onUpgrade);
  }

  onModuleDestroy(): void {
    this.httpServer?.off('upgrade', this.onUpgrade);

    for (const socket of this.sessions.keys()) {
      socket.close(CLOSE_GOING_AWAY, 'Server is shutting down');
    }

    this.sockets.close();
  }

  async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    // The only WebSocket endpoint: anything else would hang unanswered.
    if (!isTerminalPath(request.url)) {
      socket.destroy();
      return;
    }

    socket.on('error', () => undefined);

    let target: AuthorizedTarget;

    try {
      target = await this.authorize(request);
    } catch (error) {
      const rejection =
        error instanceof UpgradeRejection
          ? error
          : error instanceof HttpException
            ? new UpgradeRejection(error.getStatus(), error.message)
            : new UpgradeRejection(503, 'Terminal is unavailable');

      if (!(
        error instanceof UpgradeRejection || error instanceof HttpException
      )) {
        this.logger.warn(`Terminal upgrade failed: ${describeError(error)}`);
      }

      reject(socket, rejection.status, rejection.message);
      return;
    }

    this.sockets.handleUpgrade(request, socket, head, (client) => {
      void this.start(client, target);
    });
  }

  private async authorize(request: IncomingMessage): Promise<AuthorizedTarget> {
    const origin = request.headers.origin;

    // Browsers always send Origin on WebSockets; a foreign one is a
    // cross-site hijack attempt riding the session cookie.
    if (origin !== undefined && !isTrustedOrigin(origin)) {
      throw new UpgradeRejection(403, 'Origin is not allowed');
    }

    const target = parseTerminalRequest(request.url);

    if (!target) {
      throw new UpgradeRejection(404, 'Instance not found');
    }

    const session = await this.authService.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session?.user) {
      throw new UpgradeRejection(401, 'Sign in to open a terminal');
    }

    const userId = session.user.id;

    if (this.sessionCountOf(userId) >= MAX_SESSIONS_PER_USER) {
      throw new UpgradeRejection(429, 'Too many open terminals');
    }

    await this.instances.assertDocker(target.projectId, target.workloadId);

    const namespace = projectNamespace(target.projectId);
    const pod = await this.readPod(namespace, target.pod);

    if (pod.metadata?.labels?.[WORKLOAD_ID_LABEL] !== target.workloadId) {
      throw new UpgradeRejection(404, 'Instance not found');
    }

    if (pod.status?.phase !== 'Running' || pod.metadata?.deletionTimestamp) {
      throw new UpgradeRejection(409, 'Instance is not running');
    }

    return { ...target, namespace, userId };
  }

  private async readPod(namespace: string, name: string): Promise<V1Pod> {
    try {
      return await this.kubernetes.coreV1.readNamespacedPod({
        namespace,
        name,
      });
    } catch (error) {
      if (getKubernetesStatusCode(error) === 404) {
        throw new UpgradeRejection(404, 'Instance not found');
      }

      throw error;
    }
  }

  private sessionCountOf(userId: string): number {
    let count = 0;

    for (const owner of this.sessions.values()) {
      if (owner === userId) {
        count += 1;
      }
    }

    return count;
  }

  private async start(
    client: WebSocket,
    target: AuthorizedTarget,
  ): Promise<void> {
    const label = `${target.namespace}/${target.pod}`;
    const input = new PassThrough();
    const output = new TerminalOutput(client, target.cols, target.rows);
    let connection: PodExecConnection | null = null;
    let finished = false;
    let alive = true;

    this.sessions.set(client, target.userId);
    this.logger.log(`Terminal opened on ${label} by user ${target.userId}`);

    const send = (message: WorkloadTerminalServerMessage) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    };

    /** Sends the last control frame once, then closes the browser socket. */
    const finish = (
      message: WorkloadTerminalServerMessage,
      code = CLOSE_NORMAL,
    ) => {
      if (finished) {
        return;
      }

      finished = true;
      send(message);
      client.close(code);
    };

    const ping = setInterval(() => {
      if (!alive) {
        client.terminate();
        return;
      }

      alive = false;
      client.ping();
    }, PING_INTERVAL_MS);

    client.on('pong', () => {
      alive = true;
    });

    client.on('message', (data, isBinary) => {
      if (isBinary) {
        input.write(toBuffer(data));
        return;
      }

      const message = parseControl(toBuffer(data).toString('utf8'));

      if (message?.type === 'resize') {
        output.resize(
          toDimension(message.cols, output.columns),
          toDimension(message.rows, output.rows),
        );
      }
    });

    client.on('close', () => {
      finished = true;
      clearInterval(ping);
      this.sessions.delete(client);
      input.end();
      connection?.close();
      this.logger.log(`Terminal closed on ${label}`);
    });

    client.on('error', (error) => {
      this.logger.warn(
        `Terminal socket error on ${label}: ${describeError(error)}`,
      );
    });

    try {
      connection = await this.kubernetes.execInPod({
        namespace: target.namespace,
        pod: target.pod,
        container: CONTAINER_NAME,
        command: TERMINAL_COMMAND,
        output,
        input,
        onStatus: (status) => {
          const code = exitCodeOf(status);

          finish({
            type: 'exit',
            code,
            message:
              code === 0
                ? 'Session ended'
                : (status.message ?? 'Session ended'),
          });
        },
      });
    } catch (error) {
      this.logger.warn(
        `Terminal exec failed on ${label}: ${describeError(error)}`,
      );
      finish(
        { type: 'error', message: 'Could not start a shell in the instance' },
        CLOSE_INTERNAL_ERROR,
      );
      return;
    }

    // The browser left while the exec stream was opening.
    if (client.readyState !== WebSocket.OPEN) {
      connection.close();
      return;
    }

    connection.on('error', (error) => {
      this.logger.warn(
        `Terminal exec error on ${label}: ${describeError(error)}`,
      );
    });

    connection.on('close', () => {
      finish({
        type: 'exit',
        code: null,
        message: 'Connection to the instance closed',
      });
    });
  }
}
