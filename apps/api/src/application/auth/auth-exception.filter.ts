import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { APIError } from 'better-auth';
import type { Response } from 'express';

@Catch(APIError)
export class AuthExceptionFilter implements ExceptionFilter {
  catch(exception: APIError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.statusCode ?? 500;

    response.status(status).json({
      statusCode: status,
      message: exception.body?.message ?? exception.message,
      code: exception.body?.code,
    });
  }
}
