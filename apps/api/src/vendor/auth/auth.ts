import 'dotenv/config';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth';
import { db } from '@/vendor/db/client';
import * as schema from '@/vendor/db/schema';
import { getTrustedOrigins } from './trusted-origins';

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:8080',
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET,
  // Read per request: the console can add its control plane URL at runtime.
  trustedOrigins: () => getTrustedOrigins(),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
});

export type Auth = typeof auth;
