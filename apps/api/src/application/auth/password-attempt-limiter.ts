import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

export const PASSWORD_MAX_FAILURES = 5;
export const PASSWORD_WINDOW_MS = 15 * 60 * 1000;

interface Attempts {
  failures: number;
  resetAt: number;
}

/**
 * Brute-force guard for the current-password check. better-auth rate limits
 * only requests that reach its HTTP handler, and this app calls its API
 * directly, so the limit lives here. Counted per user, in memory.
 */
@Injectable()
export class PasswordAttemptLimiter {
  private readonly attempts = new Map<string, Attempts>();

  assertAllowed(userId: string, now = Date.now()): void {
    const entry = this.attempts.get(userId);

    if (!entry) {
      return;
    }

    if (entry.resetAt <= now) {
      this.attempts.delete(userId);
      return;
    }

    if (entry.failures >= PASSWORD_MAX_FAILURES) {
      const minutes = Math.ceil((entry.resetAt - now) / 60_000);

      throw new HttpException(
        `Too many incorrect attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(userId: string, now = Date.now()): void {
    const entry = this.attempts.get(userId);

    if (!entry || entry.resetAt <= now) {
      this.attempts.set(userId, {
        failures: 1,
        resetAt: now + PASSWORD_WINDOW_MS,
      });
      return;
    }

    entry.failures += 1;
  }

  reset(userId: string): void {
    this.attempts.delete(userId);
  }
}
