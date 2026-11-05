import { Injectable } from '@nestjs/common';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  parseServiceAddress,
  readBody,
  type ServiceTarget,
} from '@/vendor/kubernetes/service-proxy';

/**
 * The Service `deploy/install.sh` and `scripts/cluster.sh` create for the
 * single-node VictoriaMetrics release.
 */
export const DEFAULT_VICTORIAMETRICS_ADDRESS =
  'victoria-metrics.victoria-metrics:8428';

const REQUEST_TIMEOUT_MS = 15_000;

/** One series of a Prometheus-compatible instant or range query. */
export interface PromSeries {
  metric: Record<string, string>;
  /** Range queries: `[unix seconds, "value"]` pairs. */
  values?: [number, string][];
  /** Instant queries: a single `[unix seconds, "value"]` pair. */
  value?: [number, string];
}

interface PromResponse {
  status: 'success' | 'error';
  data?: { resultType: string; result: PromSeries[] };
  error?: string;
}

/** VictoriaMetrics did not answer, or answered with an error. */
export class VictoriaMetricsUnavailableError extends Error {}

/**
 * The VictoriaMetrics Prometheus-compatible query API, reached through the
 * Kubernetes API server's service proxy so it works with the API inside or
 * outside the cluster.
 */
@Injectable()
export class VictoriaMetricsClient {
  constructor(private readonly kubernetes: KubernetesService) {}

  private get target(): ServiceTarget {
    return parseServiceAddress(
      process.env.VICTORIAMETRICS_ADDRESS?.trim() ||
        DEFAULT_VICTORIAMETRICS_ADDRESS,
      'victoria-metrics',
      '8428',
    );
  }

  /** Evaluates `promql` at `time` (unix seconds). */
  query(promql: string, time: number): Promise<PromSeries[]> {
    return this.request('/api/v1/query', { query: promql, time: `${time}` });
  }

  /** Evaluates `promql` from `start` to `end` every `step` seconds. */
  queryRange(
    promql: string,
    start: number,
    end: number,
    step: number,
  ): Promise<PromSeries[]> {
    return this.request('/api/v1/query_range', {
      query: promql,
      start: `${start}`,
      end: `${end}`,
      step: `${step}s`,
    });
  }

  private async request(
    path: string,
    query: Record<string, string>,
  ): Promise<PromSeries[]> {
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
      throw new VictoriaMetricsUnavailableError(
        `VictoriaMetrics request failed: ${(error as Error).message}`,
      );
    }

    let body: PromResponse;

    try {
      body = JSON.parse(text) as PromResponse;
    } catch {
      throw new VictoriaMetricsUnavailableError(
        `VictoriaMetrics returned HTTP ${status ?? 'unknown'} with a non-JSON body`,
      );
    }

    if (body.status !== 'success' || !body.data) {
      throw new VictoriaMetricsUnavailableError(
        `VictoriaMetrics query failed: ${body.error ?? `HTTP ${status}`}`,
      );
    }

    return body.data.result;
  }
}
