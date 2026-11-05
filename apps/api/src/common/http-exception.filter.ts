import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorResponse } from '@acceleratio/shared';
import type { Response } from 'express';

/**
 * Turns every unhandled failure into the shared error contract:
 * `{ status_code, message, code? }`. Known Nest exceptions keep their status
 * and message; anything else becomes a 500 with a generic message so internal
 * details never reach the client. The global filter is registered in main.ts.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toErrorResponse(exception);

    response.status(body.status_code).json(body);
  }

  private toErrorResponse(exception: unknown): ApiErrorResponse {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    const message =
      exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error(`Unhandled exception: ${message}`, stack);

    return {
      status_code: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }

  private fromHttpException(exception: HttpException): ApiErrorResponse {
    const response = exception.getResponse();
    const body: ApiErrorResponse = {
      status_code: exception.getStatus(),
      message: exception.message,
    };

    if (typeof response === 'string') {
      body.message = response;

      return body;
    }

    if (typeof response === 'object' && response !== null) {
      const payload = response as { message?: unknown; code?: unknown };
      const message = this.toMessage(payload.message);

      if (message) {
        body.message = message;
      }

      if (typeof payload.code === 'string') {
        body.code = payload.code;
      }
    }

    return body;
  }

  private toMessage(value: unknown): string | undefined {
    if (typeof value === 'string' && value) {
      return value;
    }

    if (Array.isArray(value)) {
      const parts = value.filter(
        (part): part is string => typeof part === 'string' && part.length > 0,
      );

      return parts.length > 0 ? parts.join(', ') : undefined;
    }

    return undefined;
  }
}
