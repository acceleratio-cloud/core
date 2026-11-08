import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '@/app.module';
import { HttpExceptionFilter } from '@/common/http-exception.filter';
import { isTrustedOrigin } from '@/vendor/auth/trusted-origins';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // GitHub webhook signatures are computed over the exact request bytes.
    rawBody: true,
  });

  // GitHub push deliveries list up to 20 commits with their files and pass
  // the 100 KB default; a rejected delivery would skip a deploy.
  app.useBodyParser('json', { limit: '2mb' });

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
