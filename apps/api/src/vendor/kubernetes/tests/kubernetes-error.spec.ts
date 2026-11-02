import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getKubernetesStatusCode, toNestException } from '../kubernetes-error';

// Mirrors the shape of @kubernetes/client-node's ApiException without loading
// the ESM-only package in Jest.
const apiException = (code: number, body: unknown = {}) =>
  Object.assign(new Error('cluster failure'), { code, body });

describe('getKubernetesStatusCode', () => {
  it('reads the status from an ApiException', () => {
    expect(getKubernetesStatusCode(apiException(404))).toBe(404);
  });

  it('walks causes and nested responses', () => {
    expect(getKubernetesStatusCode({ cause: { code: 403 } })).toBe(403);
    expect(getKubernetesStatusCode({ response: { status: 500 } })).toBe(500);
  });

  it('returns undefined for transport failures', () => {
    expect(
      getKubernetesStatusCode(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
      ),
    ).toBeUndefined();
  });
});

describe('toNestException', () => {
  it('maps 403 to ForbiddenException', () => {
    const error = toNestException(apiException(403));

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toBe(
      'Cluster credentials cannot manage project resources',
    );
  });

  it('maps 409 to ConflictException', () => {
    expect(toNestException(apiException(409))).toBeInstanceOf(
      ConflictException,
    );
  });

  it('maps 422 to BadRequestException with the body message', () => {
    const error = toNestException(
      apiException(422, {
        message:
          'Deployment.apps "my-api" is invalid: spec.template.spec.containers[0].image: Required value',
      }),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe(
      'Deployment.apps "my-api" is invalid: spec.template.spec.containers[0].image: Required value',
    );
  });

  it('uses a generic message for a 422 without a body message', () => {
    const error = toNestException(apiException(422));

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe('Cluster rejected the workload configuration');
  });

  it('maps connection refused to ServiceUnavailableException', () => {
    const error = toNestException(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6443'), {
        code: 'ECONNREFUSED',
      }),
    );

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.message).toBe('Kubernetes API is unavailable');
    expect(error.message).not.toContain('ECONNREFUSED');
  });

  it('maps missing configuration to ServiceUnavailableException', () => {
    const error = toNestException(new Error('No active cluster!'));

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.message).toBe('Kubernetes API is unavailable');
  });

  it('does not leak cluster internals through the generic fallback', () => {
    const error = toNestException(
      new Error('secret internal detail at 10.0.0.1'),
    );

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.message).toBe('Kubernetes API is unavailable');
    expect(error.message).not.toContain('secret internal detail');
  });
});
