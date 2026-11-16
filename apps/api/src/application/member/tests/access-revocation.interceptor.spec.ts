import type { ExecutionContext } from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Subject } from 'rxjs';
import type { Database } from '@/vendor/db/database.constants';
import { AccessRevocationInterceptor } from '../access-revocation.interceptor';
import { AccessService } from '../access.service';

const contextFor = (handler: () => void, userId: string) =>
  ({
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => ({ access: { userId } }) }),
  }) as unknown as ExecutionContext;

describe('AccessRevocationInterceptor', () => {
  const access = new AccessService({} as Database);
  const interceptor = new AccessRevocationInterceptor(new Reflector(), access);

  it("ends a live stream when its viewer's access changes", () => {
    const handler = () => undefined;
    Reflect.defineMetadata(SSE_METADATA, true, handler);
    const source = new Subject<number>();
    const seen: number[] = [];
    let completed = false;

    interceptor
      .intercept(contextFor(handler, 'user-1'), { handle: () => source })
      .subscribe({
        next: (value) => seen.push(value as number),
        complete: () => (completed = true),
      });

    source.next(1);
    access.notify(['user-2']);
    source.next(2);
    access.notify(['user-1']);
    source.next(3);

    expect(seen).toEqual([1, 2]);
    expect(completed).toBe(true);
  });

  it('leaves ordinary routes alone', () => {
    const source = new Subject<number>();

    expect(
      interceptor.intercept(
        contextFor(() => undefined, 'user-1'),
        {
          handle: () => source,
        },
      ),
    ).toBe(source);
  });
});
