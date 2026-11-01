// better-auth ships ESM only, which Jest cannot load from a CommonJS test.
// These modules are stubbed so the tests cover this app's logic, not the
// library's internals.
jest.mock('@thallesp/nestjs-better-auth', () => ({
  AuthService: class AuthService {},
  AllowAnonymous: () => () => undefined,
  OptionalAuth: () => () => undefined,
  Session: () => () => undefined,
}));

jest.mock('better-auth', () => ({
  APIError: class APIError extends Error {},
}));

jest.mock('better-auth/node', () => ({
  fromNodeHeaders: () => new Headers(),
}));

import type { Request, Response } from 'express';
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthService, type UserSession } from '@thallesp/nestjs-better-auth';
import { DATABASE } from '@/vendor/db/database.constants';
import { AuthController } from './auth.controller';

const createRequest = (): Request => ({ headers: {} }) as unknown as Request;

const createResponse = () => {
  const setHeader = jest.fn();

  return {
    response: { setHeader } as unknown as Response,
    setHeader,
  };
};

const authResult = <T>(response: T, cookies: string[] = []) => {
  const headers = new Headers();
  cookies.forEach((cookie) => headers.append('set-cookie', cookie));

  return { headers, response };
};

const createFixture = async (usersCount: number) => {
  const db = { $count: jest.fn().mockResolvedValue(usersCount) };
  const auth = {
    api: {
      signUpEmail: jest.fn(),
      signInEmail: jest.fn(),
      signOut: jest.fn(),
    },
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      { provide: DATABASE, useValue: db },
      { provide: AuthService, useValue: auth },
    ],
  }).compile();

  return { controller: moduleRef.get(AuthController), auth };
};

const signUpPayload = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'secret-password',
};

describe('AuthController', () => {
  describe('status', () => {
    it('reports the console as uninitialized while no account exists', async () => {
      const { controller } = await createFixture(0);

      await expect(controller.status()).resolves.toEqual({
        initialized: false,
      });
    });

    it('reports the console as initialized once an account exists', async () => {
      const { controller } = await createFixture(2);

      await expect(controller.status()).resolves.toEqual({ initialized: true });
    });
  });

  describe('signUpEmail', () => {
    it('forbids a second account', async () => {
      const { controller, auth } = await createFixture(1);
      const { response } = createResponse();

      await expect(
        controller.signUpEmail(signUpPayload, createRequest(), response),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(auth.api.signUpEmail).not.toHaveBeenCalled();
    });

    it('forwards the payload and the session cookies', async () => {
      const { controller, auth } = await createFixture(0);
      const { response, setHeader } = createResponse();
      const created = { user: { id: 'user-1' } };

      auth.api.signUpEmail.mockResolvedValue(
        authResult(created, ['better-auth.session=abc; Path=/']),
      );

      await expect(
        controller.signUpEmail(signUpPayload, createRequest(), response),
      ).resolves.toEqual(created);

      expect(auth.api.signUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          body: signUpPayload,
          returnHeaders: true,
        }),
      );
      expect(setHeader).toHaveBeenCalledWith('set-cookie', [
        'better-auth.session=abc; Path=/',
      ]);
    });

    it('leaves the response alone when no cookie is set', async () => {
      const { controller, auth } = await createFixture(0);
      const { response, setHeader } = createResponse();

      auth.api.signUpEmail.mockResolvedValue(authResult({ user: null }));

      await controller.signUpEmail(signUpPayload, createRequest(), response);

      expect(setHeader).not.toHaveBeenCalled();
    });
  });

  describe('signInEmail', () => {
    it('returns the better-auth response and copies the cookies', async () => {
      const { controller, auth } = await createFixture(1);
      const { response, setHeader } = createResponse();
      const payload = { email: 'ada@example.com', password: 'secret-password' };
      const signedIn = { user: { id: 'user-1' } };

      auth.api.signInEmail.mockResolvedValue(
        authResult(signedIn, ['better-auth.session=def; Path=/']),
      );

      await expect(
        controller.signInEmail(payload, createRequest(), response),
      ).resolves.toEqual(signedIn);

      expect(setHeader).toHaveBeenCalledWith('set-cookie', [
        'better-auth.session=def; Path=/',
      ]);
    });
  });

  describe('session', () => {
    it('returns empty fields for an anonymous request', async () => {
      const { controller } = await createFixture(1);

      expect(controller.session(null)).toEqual({ session: null, user: null });
    });

    it('passes the resolved session through', async () => {
      const { controller } = await createFixture(1);
      const current = {
        session: { id: 'session-1' },
        user: { id: 'user-1' },
      } as unknown as UserSession;

      expect(controller.session(current)).toEqual(current);
    });
  });

  describe('signOut', () => {
    it('forwards the better-auth result', async () => {
      const { controller, auth } = await createFixture(1);
      const { response } = createResponse();

      auth.api.signOut.mockResolvedValue(authResult({ success: true }));

      await expect(
        controller.signOut(createRequest(), response),
      ).resolves.toEqual({ success: true });
    });
  });
});
