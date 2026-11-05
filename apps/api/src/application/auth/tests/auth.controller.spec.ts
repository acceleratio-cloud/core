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
import { AuthController } from '../auth.controller';

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

const user = {
  id: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  emailVerified: true,
  image: null,
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-02T10:00:00.000Z'),
};

const serializedUser = {
  id: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  email_verified: true,
  image: null,
  created_at: '2026-01-01T10:00:00.000Z',
  updated_at: '2026-01-02T10:00:00.000Z',
};

const session = {
  id: 'session-1',
  token: 'token-abc',
  userId: 'user-1',
  expiresAt: new Date('2026-01-08T10:00:00.000Z'),
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-02T10:00:00.000Z'),
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

const serializedSession = {
  id: 'session-1',
  token: 'token-abc',
  user_id: 'user-1',
  expires_at: '2026-01-08T10:00:00.000Z',
  created_at: '2026-01-01T10:00:00.000Z',
  updated_at: '2026-01-02T10:00:00.000Z',
  ip_address: '127.0.0.1',
  user_agent: 'jest',
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

    it('forwards the payload, the session cookies and serializes the user', async () => {
      const { controller, auth } = await createFixture(0);
      const { response, setHeader } = createResponse();
      const created = { token: 'token-abc', user };

      auth.api.signUpEmail.mockResolvedValue(
        authResult(created, ['better-auth.session=abc; Path=/']),
      );

      await expect(
        controller.signUpEmail(signUpPayload, createRequest(), response),
      ).resolves.toEqual({ token: 'token-abc', user: serializedUser });

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

      auth.api.signUpEmail.mockResolvedValue(
        authResult({ token: 'token-abc', user }),
      );

      await controller.signUpEmail(signUpPayload, createRequest(), response);

      expect(setHeader).not.toHaveBeenCalled();
    });
  });

  describe('signInEmail', () => {
    it('keeps better-auth fields and serializes the user', async () => {
      const { controller, auth } = await createFixture(1);
      const { response, setHeader } = createResponse();
      const payload = { email: 'ada@example.com', password: 'secret-password' };
      const signedIn = {
        redirect: false,
        token: 'token-def',
        url: '/dashboard',
        user,
      };

      auth.api.signInEmail.mockResolvedValue(
        authResult(signedIn, ['better-auth.session=def; Path=/']),
      );

      await expect(
        controller.signInEmail(payload, createRequest(), response),
      ).resolves.toEqual({
        redirect: false,
        token: 'token-def',
        url: '/dashboard',
        user: serializedUser,
      });

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

    it('serializes the resolved session and user to snake_case', async () => {
      const { controller } = await createFixture(1);
      const current = {
        session,
        user: { ...user, role: 'admin' },
      } as unknown as UserSession;

      expect(controller.session(current)).toEqual({
        session: serializedSession,
        user: serializedUser,
      });
      expect(controller.session(current).user).not.toHaveProperty('role');
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
