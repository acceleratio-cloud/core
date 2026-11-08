import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';
import { HttpExceptionFilter } from '@/common/http-exception.filter';
import { isTrustedOrigin } from '@/vendor/auth/trusted-origins';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // GitHub webhook signatures are computed over the exact request bytes.
    rawBody: true,
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    // Requests without an Origin (same-origin GETs, server-side calls) pass.
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => callback(null, !origin || isTrustedOrigin(origin)),
    credentials: true,
  });

  // Stops the workload observer (informers, timers) on SIGTERM and close.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 8080);
}
void bootstrap();
