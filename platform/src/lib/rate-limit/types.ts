/**
 * Provider-agnostic rate-limiting interface (Module 2 §11; Step 3 design §1).
 * Authentication and invitation logic must depend only on this interface,
 * never on a specific backend directly — see PostgresRateLimiter for the
 * initial implementation.
 */

export interface RateLimitConfig {
  /** Maximum number of attempts allowed within the window. */
  limit: number;
  /** Fixed window length, in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export interface RateLimiter {
  /**
   * Read-only check against the current count for `key`. Does not itself
   * increment anything. Must never be relied on as the sole gate before a
   * sensitive action — it is not atomic with the action itself.
   */
  checkLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult>;

  /**
   * The actual enforcement point. Atomically increments the counter for
   * `key` within its current window (creating or resetting the window if
   * absent or expired) in a single backend operation, and returns whether
   * this attempt is within limit. Callers make their real allow/deny
   * decision from this return value.
   */
  recordAttempt(key: string, config: RateLimitConfig): Promise<RateLimitResult>;

  /** Clears a key's counter immediately. */
  resetLimit(key: string): Promise<void>;
}
