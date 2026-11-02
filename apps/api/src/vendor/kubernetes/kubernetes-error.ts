import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';

const FORBIDDEN_MESSAGE = 'Cluster credentials cannot manage project resources';
const CONFLICT_MESSAGE =
  'Cluster resource changed while the request was being applied';
const INVALID_MESSAGE = 'Cluster rejected the workload configuration';
const UNAVAILABLE_MESSAGE = 'Kubernetes API is unavailable';

interface KubernetesErrorDetails {
  status?: number;
  bodyMessage?: string;
}

/**
 * Kubernetes client errors carry the HTTP status in `code` (ApiException) or
 * in a nested response. The cause chain is walked because the fetch layer wraps
 * transport failures.
 */
const toStatusCode = (value: unknown): number | undefined =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 100 &&
  value <= 599
    ? value
    : undefined;

const toRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const collectDetails = (error: unknown): KubernetesErrorDetails => {
  const details: KubernetesErrorDetails = {};
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const record = toRecord(current);

    if (!record) {
      break;
    }

    details.status ??=
      toStatusCode(record.code) ?? toStatusCode(record.statusCode);

    const response = toRecord(record.response);

    details.status ??=
      toStatusCode(response?.status) ?? toStatusCode(response?.statusCode);

    const body = toRecord(record.body);

    if (
      details.bodyMessage === undefined &&
      typeof body?.message === 'string' &&
      body.message
    ) {
      details.bodyMessage = body.message;
    }

    current = record.cause ?? response?.data ?? record.error;
  }

  return details;
};

/**
 * Returns the Kubernetes HTTP status for an error thrown by any API client, or
 * `undefined` for transport failures, missing configuration and unknown shapes.
 */
export const getKubernetesStatusCode = (error: unknown): number | undefined =>
  collectDetails(error).status;

/**
 * Maps a Kubernetes API failure to a Nest exception without leaking cluster
 * internals (server addresses, resource bodies, credentials) to the client.
 * Callers handle expected 404 responses themselves before mapping.
 */
export const toNestException = (error: unknown): HttpException => {
  const { status, bodyMessage } = collectDetails(error);

  switch (status) {
    case 403:
      return new ForbiddenException(FORBIDDEN_MESSAGE);
    case 409:
      return new ConflictException(CONFLICT_MESSAGE);
    case 422:
      return new BadRequestException(bodyMessage ?? INVALID_MESSAGE);
    default:
      return new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
  }
};
