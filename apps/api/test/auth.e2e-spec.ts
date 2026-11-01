// better-auth ships ESM only, which Jest cannot load from a CommonJS test.
// The HTTP surface is what matters here, so the library is stubbed out.
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

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthController } from '@/application/auth/auth.controller';
import { DATABASE } from '@/vendor/db/database.constants';

const signInPayload = {
  email: 'ada@example.com',
  password: 'secret-password',
};

const signUpPayload = {
  name: 'Ada Lovelace',
  ...signInPayload,
};

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let countUsers: jest.Mock;
  let signInEmail: jest.Mock;

  beforeEach(async () => {
    countUsers = jest.fn().mockResolvedValue(0);
    signInEmail = jest.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: DATABASE, useValue: { $count: countUsers } },
        {
          provide: AuthService,
          useValue: {
            api: { signUpEmail: jest.fn(), signInEmail, signOut: jest.fn() },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /auth/status reports the first-run state', async () => {
    await request(app.getHttpServer())
      .get('/auth/status')
      .expect(200, { initialized: false });

    countUsers.mockResolvedValue(3);

    await request(app.getHttpServer())
      .get('/auth/status')
      .expect(200, { initialized: true });
  });

  it('POST /auth/sign-up/email is closed after the first account', async () => {
    countUsers.mockResolvedValue(1);

    const response = await request(app.getHttpServer())
      .post('/auth/sign-up/email')
      .send(signUpPayload)
      .expect(403);

    expect(response.body).toMatchObject({
      message: 'Initial setup has already been completed',
    });
  });

  it('POST /auth/sign-in/email forwards the session cookie', async () => {
    const headers = new Headers();
    headers.append('set-cookie', 'better-auth.session=abc; Path=/');
    signInEmail.mockResolvedValue({
      headers,
      response: { user: { id: 'user-1' } },
    });

    const response = await request(app.getHttpServer())
      .post('/auth/sign-in/email')
      .send(signInPayload)
      .expect(200);

    expect(response.body).toEqual({ user: { id: 'user-1' } });
    expect(response.headers['set-cookie']).toEqual([
      'better-auth.session=abc; Path=/',
    ]);
  });
});
