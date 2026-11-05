import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { HttpExceptionFilter } from '../http-exception.filter';

const createHost = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status } as unknown as Response;
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
};

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns status_code and message for a Nest exception', () => {
    const { host, status, json } = createHost();

    filter.catch(new NotFoundException('Project not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      status_code: 404,
      message: 'Project not found',
    });
  });

  it('joins the validation messages Nest puts in the response', () => {
    const { host, json } = createHost();

    filter.catch(
      new BadRequestException({
        message: ['name should not be empty', 'name must be a string'],
        error: 'Bad Request',
        statusCode: 400,
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      status_code: 400,
      message: 'name should not be empty, name must be a string',
    });
  });

  it('keeps an explicit error code', () => {
    const { host, json } = createHost();

    filter.catch(
      new HttpException(
        { message: 'Email is already taken', code: 'EMAIL' },
        409,
      ),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      status_code: 409,
      message: 'Email is already taken',
      code: 'EMAIL',
    });
  });

  it('returns a generic 500 and logs unknown exceptions', () => {
    const { host, status, json } = createHost();
    const logger = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    filter.catch(new Error('database password leaked here'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      status_code: 500,
      message: 'Internal server error',
    });
    expect(logger).toHaveBeenCalledWith(
      'Unhandled exception: database password leaked here',
      expect.any(String),
    );
  });

  it('handles thrown non-Error values', () => {
    const { host, status, json } = createHost();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    filter.catch('boom', host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      status_code: 500,
      message: 'Internal server error',
    });
  });
});
