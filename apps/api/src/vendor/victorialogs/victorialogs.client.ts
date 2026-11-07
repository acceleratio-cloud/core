import { Injectable } from '@nestjs/common';
import type http from 'node:http';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  parseServiceAddress,
  readBody,
  type ServiceTarget,
} from '@/vendor/kubernetes/service-proxy';

/**
 * The Service `deploy/install.sh` and `scripts/cluster.sh` create for the
 * single-node VictoriaLogs release.
 */
export const DEFAULT_VICTORIALOGS_ADDRESS = 'victoria-logs.victoria-logs:9428';

const REQUEST_TIMEOUT_MS = 20_000;

/** One stored log line: the fields Vector writes plus VictoriaLogs' own. */
export type LogRecord = Record<string, string>;

/** `/select/logsql/hits`: per-value counts on a fixed time grid. */
export interface HitsSeries {
  fields: Record<string, string>;
  timestamps: string[];
  values: number[];
  total: number;
}

/** VictoriaLogs did not answer, or answered with an error. */
export class VictoriaLogsUnavailableError extends Error {}

/** Parses JSON-lines output, skipping blank lines. */
export const parseJsonLines = (text: string): LogRecord[] =>
  text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as LogRecord);

/**
 * The VictoriaLogs LogsQL HTTP API, reached through the Kubernetes API
 * server's service proxy so it works with the API inside or outside the
 * cluster. Callers build the LogsQL; this client only transports it.
 */
@Injectable()
export class VictoriaLogsClient {
  constructor(private readonly kubernetes: KubernetesService) {}

  private get target(): ServiceTarget {
    return parseServiceAddress(
      process.env.VICTORIALOGS_ADDRESS?.trim() || DEFAULT_VICTORIALOGS_ADDRESS,
      'victoria-logs',
      '9428',
    );
  }

  /** Runs a LogsQL query and returns every matching record. */
  async query(logsql: string): Promise<LogRecord[]> {
    const text = await this.request('/select/logsql/query', { query: logsql });

    try {
      return parseJsonLines(text);
    } catch {
      throw new VictoriaLogsUnavailableError(
        'VictoriaLogs returned a malformed query response',
      );
    }
  }

  /**
   * Counts matching lines in `step`-second buckets between `start` and `end`
   * (unix seconds), split by the values of `field`.
   */
  async hits(
    logsql: string,
    start: number,
    end: number,
    step: number,
    field: string,
  ): Promise<HitsSeries[]> {
    const text = await this.request('/select/logsql/hits', {
      query: logsql,
      start: `${start}`,
      end: `${end}`,
      step: `${step}s`,
      field,
    });

    try {
      return (JSON.parse(text) as { hits?: HitsSeries[] }).hits ?? [];
    } catch {
      throw new VictoriaLogsUnavailableError(
        'VictoriaLogs returned a malformed hits response',
      );
    }
  }

  /**
   * Opens `/select/logsql/tail`: a never-ending JSON-lines response with the
   * lines that arrive from now on (plus `startOffsetSeconds` of the recent
   * past). The caller owns the response and must destroy it when done.
   */
  async tail(
    logsql: string,
    startOffsetSeconds: number,
  ): Promise<http.IncomingMessage> {
    let response: http.IncomingMessage;

    try {
      response = await this.kubernetes.proxyServiceRequest(this.target, {
        method: 'GET',
        path: '/select/logsql/tail',
        query: {
          query: logsql,
          start_offset: `${Math.max(0, Math.ceil(startOffsetSeconds))}s`,
          // Wait for lines that arrive late before emitting a window; a
          // smaller lag would drop them, a bigger one feels slow.
          offset: '2s',
          refresh_interval: '1s',
        },
        headers: { Accept: 'application/json' },
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      throw new VictoriaLogsUnavailableError(
        `VictoriaLogs request failed: ${(error as Error).message}`,
      );
    }

    if (response.statusCode !== 200) {
      const body = await readBody(response).catch(() => '');
      throw new VictoriaLogsUnavailableError(
        `VictoriaLogs tail failed with HTTP ${response.statusCode}: ${body.slice(0, 200)}`,
      );
    }

    // The connect timeout must not cut a stream that is quiet for a while.
    response.socket?.setTimeout(0);

    return response;
  }

  private async request(
    path: string,
    query: Record<string, string>,
  ): Promise<string> {
    let status: number | undefined;
    let text: string;

    try {
      const response = await this.kubernetes.proxyServiceRequest(this.target, {
        method: 'GET',
        path,
        query,
        headers: { Accept: 'application/json' },
        timeoutMs: REQUEST_TIMEOUT_MS,
      });

      status = response.statusCode;
      text = await readBody(response);
    } catch (error) {
      throw new VictoriaLogsUnavailableError(
        `VictoriaLogs request failed: ${(error as Error).message}`,
      );
    }

    if (status !== 200) {
      throw new VictoriaLogsUnavailableError(
        `VictoriaLogs returned HTTP ${status ?? 'unknown'}: ${text.slice(0, 200)}`,
      );
    }

    return text;
  }
}
