import type { HttpAdapterHost } from '@nestjs/core';
import {
  HttpShutdownService,
  SHUTDOWN_GRACE_MS,
} from '../http-shutdown.service';

describe('HttpShutdownService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const build = (server: unknown) =>
    new HttpShutdownService({
      httpAdapter: server ? { getHttpServer: () => server } : undefined,
    } as unknown as HttpAdapterHost);

  it('closes the connections still open after the grace period', () => {
    const server = { closeAllConnections: jest.fn() };

    build(server).beforeApplicationShutdown();

    jest.advanceTimersByTime(SHUTDOWN_GRACE_MS - 1);
    expect(server.closeAllConnections).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an HTTP server', () => {
    expect(() => build(null).beforeApplicationShutdown()).not.toThrow();
  });
});
