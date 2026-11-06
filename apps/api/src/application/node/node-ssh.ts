import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Client } from 'ssh2';
import type { NodeSshAccess } from '@acceleratio/shared';

const HOSTNAME = /^[A-Za-z0-9]([-A-Za-z0-9.]{0,251}[A-Za-z0-9])?$/;
const USERNAME = /^[a-z_][a-z0-9_-]{0,31}$/;
const MAX_KEY_LENGTH = 16 * 1024;
const CONNECT_TIMEOUT_MS = 15_000;
const HOST_KEY = /^SHA256:[A-Za-z0-9+/]{43}$/;

export interface ValidSshAccess {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  passphrase?: string;
  /** Expected host key fingerprint; the connection fails on another key. */
  hostKey?: string;
}

/** OpenSSH-style fingerprint of a raw host key: "SHA256:<base64, no padding>". */
export const fingerprintHostKey = (key: Buffer): string =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

/** The private key and passphrase must never reach logs, rows or errors. */
export const createRedactor = (secrets: Array<string | undefined>) => {
  const values = secrets
    .flatMap((secret) => (secret ? [secret, ...secret.split('\n')] : []))
    .map((secret) => secret.trim())
    .filter((secret) => secret.length >= 6)
    .sort((a, b) => b.length - a.length);

  return (text: string): string => {
    let result = text.replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      '[redacted key]',
    );

    for (const value of values) {
      result = result.split(value).join('***');
    }

    return result;
  };
};

const isForbiddenAddress = (host: string): boolean =>
  host === 'localhost' ||
  /^127\./.test(host) ||
  /^169\.254\./.test(host) ||
  /^0\./.test(host) ||
  host === '::1' ||
  host === '::' ||
  /^fe80:/i.test(host);

export const validateSshAccess = (
  access: NodeSshAccess | undefined,
): ValidSshAccess => {
  const candidate = access as Partial<NodeSshAccess> | undefined;
  const host = candidate?.host?.trim();

  if (!host || (isIP(host) === 0 && !HOSTNAME.test(host))) {
    throw new BadRequestException('SSH host must be an IP address or hostname');
  }

  if (isForbiddenAddress(host)) {
    throw new BadRequestException('SSH host must not be a loopback address');
  }

  const port = candidate?.port ?? 22;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BadRequestException('SSH port must be 1 to 65535');
  }

  const username = candidate?.username?.trim();

  if (!username || !USERNAME.test(username)) {
    throw new BadRequestException('SSH username is invalid');
  }

  const privateKey = candidate?.private_key?.trim();

  if (
    !privateKey ||
    privateKey.length > MAX_KEY_LENGTH ||
    !privateKey.startsWith('-----BEGIN')
  ) {
    throw new BadRequestException(
      'SSH private key must be a PEM or OpenSSH key',
    );
  }

  if (
    candidate?.passphrase !== undefined &&
    (typeof candidate.passphrase !== 'string' ||
      candidate.passphrase.length > 1024)
  ) {
    throw new BadRequestException('SSH passphrase is invalid');
  }

  const hostKey = candidate?.host_key?.trim() || undefined;

  if (hostKey !== undefined && !HOST_KEY.test(hostKey)) {
    throw new BadRequestException('SSH host key must be a SHA256 fingerprint');
  }

  return {
    host,
    port,
    username,
    privateKey: `${privateKey}\n`,
    passphrase: candidate?.passphrase || undefined,
    hostKey,
  };
};

export interface SshRunOptions {
  /** Written to the command's stdin, so secrets stay off the command line. */
  stdin?: string;
  /** Called per output line (stdout and stderr). */
  onLine?: (line: string) => void;
  timeoutMs?: number;
}

/** One authenticated SSH connection. */
export interface SshSession {
  /** Fingerprint of the host key the server presented. */
  readonly hostKey: string;
  /** Runs a command and resolves with its exit code. */
  run(command: string, options?: SshRunOptions): Promise<number>;
  close(): void;
}

/** Opens SSH connections; replaced in tests. */
export abstract class SshConnector {
  /** Rejects when `access.hostKey` is set and the server presents another key. */
  abstract connect(access: ValidSshAccess): Promise<SshSession>;
}

@Injectable()
export class Ssh2Connector extends SshConnector {
  connect(access: ValidSshAccess): Promise<SshSession> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;
      let presented: string | undefined;

      client
        .on('ready', () => {
          settled = true;
          resolve(new Ssh2Session(client, presented ?? ''));
        })
        .on('error', (error: Error) => {
          if (!settled) {
            settled = true;
            reject(
              presented !== undefined &&
                access.hostKey !== undefined &&
                presented !== access.hostKey
                ? new Error(
                    `Host key ${presented} does not match the expected ${access.hostKey}`,
                  )
                : error,
            );
          }
        })
        .connect({
          host: access.host,
          port: access.port,
          username: access.username,
          privateKey: access.privateKey,
          passphrase: access.passphrase,
          readyTimeout: CONNECT_TIMEOUT_MS,
          // Without an expected key (preflight of a new server) any key is
          // accepted and returned for the operator to verify; with one, the
          // server must present exactly that key before anything is sent.
          hostVerifier: (key: Buffer) => {
            presented = fingerprintHostKey(key);

            return access.hostKey === undefined || presented === access.hostKey;
          },
        });
    });
  }
}

class Ssh2Session implements SshSession {
  constructor(
    private readonly client: Client,
    readonly hostKey: string,
  ) {}

  run(command: string, options: SshRunOptions = {}): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = options.timeoutMs
        ? setTimeout(() => {
            this.client.end();
            reject(new Error('SSH command timed out'));
          }, options.timeoutMs)
        : undefined;

      this.client.exec(command, (error, stream) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }

        let pending = '';
        const feed = (chunk: Buffer) => {
          pending += chunk.toString('utf8');
          const lines = pending.split('\n');

          pending = lines.pop() ?? '';

          for (const line of lines) {
            options.onLine?.(line.replace(/\r$/, ''));
          }
        };

        stream.on('data', feed);
        stream.stderr.on('data', feed);
        stream.on('close', (code: number | null) => {
          clearTimeout(timer);

          if (pending) {
            options.onLine?.(pending);
          }

          resolve(code ?? 255);
        });

        stream.end(options.stdin ?? '');
      });
    });
  }

  close(): void {
    this.client.end();
  }
}
