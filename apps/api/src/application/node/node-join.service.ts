import { isIP } from 'node:net';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  AddNodePayload,
  NodeOperation,
  NodePreflightResult,
  PreflightNodePayload,
} from '@acceleratio/shared';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import { NodeService } from './node.service';
import { NodeOperationStore } from './node-operation.store';
import {
  evaluatePreflight,
  installScript,
  PRIVILEGED_SHELL,
  preflightScript,
  readJoinTarget,
  validateNodeIp,
  validateNodeName,
} from './node-join-script';
import type { JoinTarget } from './node-join-script';
import { createRedactor, SshConnector, validateSshAccess } from './node-ssh';
import type { SshSession, ValidSshAccess } from './node-ssh';

const READY_TIMEOUT_MS = 5 * 60 * 1000;
const READY_POLL_MS = 5000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const PREFLIGHT_TIMEOUT_MS = 60 * 1000;

@Injectable()
export class NodeJoinService {
  private readonly logger = new Logger(NodeJoinService.name);

  constructor(
    private readonly kubernetes: KubernetesService,
    private readonly nodes: NodeService,
    private readonly operations: NodeOperationStore,
    private readonly connector: SshConnector,
  ) {}

  /** Checks a server against the join requirements without changing it. */
  async preflight(payload: PreflightNodePayload): Promise<NodePreflightResult> {
    const access = validateSshAccess(payload?.ssh);
    const role = payload?.role === 'server' ? 'server' : 'worker';
    const { target, peers } = await this.clusterFacts();
    const redact = createRedactor([access.passphrase, access.privateKey]);
    const session = await this.open(access, redact);

    try {
      const output: string[] = [];

      await session.run('bash -s', {
        stdin: preflightScript(target, peers),
        onLine: (line) => output.push(line),
        timeoutMs: PREFLIGHT_TIMEOUT_MS,
      });

      return {
        ...evaluatePreflight(output.join('\n'), peers, role),
        host_key: session.hostKey,
      };
    } finally {
      session.close();
    }
  }

  /** Starts joining a server; progress is read from the operation. */
  async add(
    payload: AddNodePayload,
    actor: string | null,
  ): Promise<NodeOperation> {
    const access = validateSshAccess(payload?.ssh);
    const name = validateNodeName(payload?.name);

    // The join token goes to this server, so it must be the one the operator
    // checked: the preflight's host key is pinned for the whole run.
    if (!access.hostKey) {
      throw new BadRequestException(
        'Run the server check first; its host key is required to add the server',
      );
    }
    const role = payload?.role;

    if (role !== 'worker' && role !== 'server') {
      throw new BadRequestException('Role must be worker or server');
    }

    const nodeIp = validateNodeIp(payload.node_ip?.trim() || access.host);
    const { target, peers } = await this.clusterFacts();

    if ((await this.nodes.list()).some((node) => node.name === name)) {
      throw new BadRequestException('A node with this name already exists');
    }

    const operation = await this.operations.start(name, 'add', actor);

    // The key lives only in this closure for the duration of the run.
    void this.run(operation.id, { access, name, nodeIp, role, target, peers });

    return operation;
  }

  private async run(
    id: string,
    input: {
      access: ValidSshAccess;
      name: string;
      nodeIp: string;
      role: 'worker' | 'server';
      target: JoinTarget;
      peers: string[];
    },
  ): Promise<void> {
    const redact = createRedactor([
      input.access.passphrase,
      input.access.privateKey,
      input.target.token,
    ]);
    const log = (line: string) =>
      this.operations.log(id, redact(line)).catch(() => undefined);
    let session: SshSession | undefined;

    try {
      await this.operations.update(id, {
        step: 'connect',
        message: 'Connecting over SSH',
      });
      session = await this.open(input.access, redact);
      await log(`Host key ${session.hostKey} verified`);

      await this.operations.update(id, {
        step: 'preflight',
        message: 'Checking requirements',
      });
      const facts: string[] = [];

      await session.run('bash -s', {
        stdin: preflightScript(input.target, input.peers),
        onLine: (line) => facts.push(line),
        timeoutMs: PREFLIGHT_TIMEOUT_MS,
      });

      const result = evaluatePreflight(
        facts.join('\n'),
        input.peers,
        input.role,
      );

      for (const check of result.checks) {
        await log(
          `${check.status.toUpperCase()} ${check.label}${check.detail ? ` (${check.detail})` : ''}`,
        );
      }

      if (!result.ok) {
        await this.operations.update(id, {
          status: 'failed',
          message: 'The server does not meet the requirements',
        });
        return;
      }

      await this.operations.update(id, {
        step: 'install',
        message: 'Installing k3s',
      });

      const code = await session.run(PRIVILEGED_SHELL, {
        stdin: installScript({
          target: input.target,
          name: input.name,
          nodeIp: input.nodeIp,
          role: input.role,
          sans: [...new Set([input.access.host, input.nodeIp])],
        }),
        onLine: (line) => void log(line),
        timeoutMs: INSTALL_TIMEOUT_MS,
      });

      if (code !== 0) {
        await this.operations.update(id, {
          status: 'failed',
          message: `The k3s installer failed (exit code ${code}); the server may need k3s uninstalled before a retry`,
        });
        return;
      }

      await this.operations.update(id, {
        step: 'wait_ready',
        message: 'Waiting for the node to become Ready',
      });

      if (await this.waitUntilReady(input.name)) {
        await this.operations.update(id, {
          status: 'succeeded',
          step: null,
          message: 'Server joined the cluster',
        });
      } else {
        await this.operations.update(id, {
          status: 'failed',
          message:
            'The node did not become Ready in time; check the log and the server',
        });
      }
    } catch (error) {
      this.logger.warn(
        `Joining ${input.name} failed: ${redact((error as Error).message)}`,
      );
      await this.operations
        .update(id, {
          status: 'failed',
          message: `Joining failed: ${redact((error as Error).message)}`,
        })
        .catch(() => undefined);
    } finally {
      session?.close();
    }
  }

  private async waitUntilReady(name: string): Promise<boolean> {
    const deadline = Date.now() + READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        if ((await this.nodes.get(name)).status === 'Ready') {
          return true;
        }
      } catch {
        // Not registered yet.
      }

      await this.sleep(READY_POLL_MS);
    }

    return false;
  }

  private async open(
    access: ValidSshAccess,
    redact: (text: string) => string,
  ): Promise<SshSession> {
    try {
      return await this.connector.connect(access);
    } catch (error) {
      throw new BadRequestException(
        `Cannot connect over SSH: ${redact((error as Error).message)}`,
      );
    }
  }

  private async clusterFacts(): Promise<{
    target: JoinTarget;
    peers: string[];
  }> {
    const { items } = await this.kubernetes.coreV1.listNode();
    const version =
      items.find((node) =>
        node.status?.nodeInfo?.kubeletVersion?.includes('+k3s'),
      )?.status?.nodeInfo?.kubeletVersion ?? null;
    const peers = items
      .map(
        (node) =>
          node.status?.addresses?.find((item) => item.type === 'InternalIP')
            ?.address,
      )
      .filter(
        (address): address is string =>
          address !== undefined && isIP(address) !== 0,
      );

    return { target: readJoinTarget(process.env, version), peers };
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
