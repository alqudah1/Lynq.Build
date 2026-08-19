/**
 * Copied verbatim from platform/src/lib/rate-limit/types.ts. Provider-
 * agnostic rate-limiting interface — application code depends only on
 * this, never on PostgresRateLimiter directly.
 */

export interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export interface RateLimiter {
  checkLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
  recordAttempt(key: string, config: RateLimitConfig): Promise<RateLimitResult>;
  resetLimit(key: string): Promise<void>;
}
