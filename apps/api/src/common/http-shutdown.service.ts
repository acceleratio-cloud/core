import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Server } from 'node:http';

/** How long in-flight requests get to finish before open connections are cut. */
export const SHUTDOWN_GRACE_MS = 5_000;

/**
 * Lets the HTTP server close while browsers hold long-lived connections.
 *
 * Nest closes the server after this hook, and `server.close()` waits for
 * every open connection. Server-sent event streams (workload events,
 * instances, live logs) stay open for as long as a console tab does, so a
 * shutdown (a rollout, a watch rebuild) would wait on them indefinitely.
 * Ordinary requests get a grace period; whatever is still open after it is
 * closed, and the browser reconnects to the new process.
 */
@Injectable()
export class HttpShutdownService implements BeforeApplicationShutdown {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  beforeApplicationShutdown(): void {
    const server = this.adapterHost.httpAdapter?.getHttpServer() as
      Server | undefined;

    if (!server) {
      return;
    }

    // Unref'd: the timer alone must not keep a finished process alive.
    setTimeout(() => server.closeAllConnections(), SHUTDOWN_GRACE_MS).unref();
  }
}
