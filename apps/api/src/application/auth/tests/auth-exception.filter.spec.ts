// better-auth ships ESM only, which Jest cannot load from a CommonJS test.
jest.mock('better-auth', () => ({
  APIError: class APIError extends Error {},
}));

import type { ArgumentsHost } from '@nestjs/common';
import type { APIError } from 'better-auth';
import type { Response } from 'express';
import { AuthExceptionFilter } from '../auth-exception.filter';

const createHost = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status } as unknown as Response;
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
};

const createException = (value: {
  statusCode?: number;
  message?: string;
  body?: { message?: string; code?: string };
}) => value as unknown as APIError;

describe('AuthExceptionFilter', () => {
  const filter = new AuthExceptionFilter();

  it('keeps the better-auth status and error code', () => {
    const { host, status, json } = createHost();

    filter.catch(
      createException({
        statusCode: 401,
        message: 'Unauthorized',
        body: {
          message: 'Invalid email or password',
          code: 'INVALID_EMAIL_OR_PASSWORD',
        },
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      status_code: 401,
      message: 'Invalid email or password',
      code: 'INVALID_EMAIL_OR_PASSWORD',
    });
  });

  it('falls back to the exception message when the body has none', () => {
    const { host, json } = createHost();

    filter.catch(
      createException({ statusCode: 400, message: 'Bad request' }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      status_code: 400,
      message: 'Bad request',
      code: undefined,
    });
  });

  it('falls back to 500 when better-auth provides no status', () => {
    const { host, status } = createHost();

    filter.catch(createException({ message: 'Unexpected failure' }), host);

    expect(status).toHaveBeenCalledWith(500);
  });
});
