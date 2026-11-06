import { ConflictException, NotFoundException } from '@nestjs/common';
import type { NodeOperation, NodeOperationType } from '@acceleratio/shared';
import { SshConnector } from '../node-ssh';
import type { SshRunOptions, SshSession, ValidSshAccess } from '../node-ssh';
import type { NodeOperationPatch } from '../node-operation.store';

export const HOST_KEY = `SHA256:${'A'.repeat(43)}`;

/** In-memory stand-in for the database-backed operation store. */
export class FakeOperationStore {
  readonly rows: NodeOperation[] = [];

  start(
    node: string,
    type: NodeOperationType,
    actor: string | null,
    remaining = 0,
  ): Promise<NodeOperation> {
    if (
      this.rows.some((row) => row.node === node && row.status === 'running')
    ) {
      return Promise.reject(
        new ConflictException('Another operation is running on this node'),
      );
    }

    const row: NodeOperation = {
      id: `op-${this.rows.length + 1}`,
      node,
      type,
      status: 'running',
      remaining,
      evicted: 0,
      stuck: [],
      message: null,
      step: null,
      log: [],
      actor,
      started_at: new Date().toISOString(),
      finished_at: null,
    };

    this.rows.push(row);

    return Promise.resolve({ ...row });
  }

  update(id: string, patch: NodeOperationPatch): Promise<void> {
    const row = this.rows.find((item) => item.id === id);

    if (row) {
      Object.assign(row, patch);

      if (patch.status && patch.status !== 'running') {
        row.finished_at = new Date().toISOString();
      }
    }

    return Promise.resolve();
  }

  log(id: string, line: string): Promise<void> {
    this.rows.find((item) => item.id === id)?.log.push(line);

    return Promise.resolve();
  }

  current(node: string): Promise<NodeOperation> {
    const row = [...this.rows].reverse().find((item) => item.node === node);

    return row
      ? Promise.resolve(row)
      : Promise.reject(new NotFoundException('No operation for this node'));
  }

  /** Waits until the newest operation of a node is no longer running. */
  async settled(node: string): Promise<NodeOperation> {
    for (let i = 0; i < 50; i += 1) {
      const row = await this.current(node);

      if (row.status !== 'running') {
        return row;
      }

      await new Promise((resolve) => setImmediate(resolve));
    }

    return this.current(node);
  }
}

/** Records SSH commands instead of opening connections. */
export class FakeConnector extends SshConnector {
  readonly commands: string[] = [];
  readonly stdin: string[] = [];
  output: string[] = [];
  exitCode = 0;
  failConnect = false;
  /** Replaces the output for commands whose stdin contains the key. */
  outputFor?: (stdin: string) => string[];

  /** Fingerprint the fake server presents. */
  hostKey = HOST_KEY;

  connect(access: ValidSshAccess): Promise<SshSession> {
    if (this.failConnect) {
      return Promise.reject(new Error('connection refused'));
    }

    if (access.hostKey !== undefined && access.hostKey !== this.hostKey) {
      return Promise.reject(
        new Error(`Host key ${this.hostKey} does not match`),
      );
    }

    return Promise.resolve({
      hostKey: this.hostKey,
      run: (command: string, options: SshRunOptions = {}) => {
        this.commands.push(command);
        this.stdin.push(options.stdin ?? '');

        for (const line of this.outputFor?.(options.stdin ?? '') ??
          this.output) {
          options.onLine?.(line);
        }

        return Promise.resolve(this.exitCode);
      },
      close: () => undefined,
    });
  }
}
