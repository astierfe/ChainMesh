/**
 * RateLimiter.ts - Per-key rate limiting (1 request/hour)
 *
 * Storage-backed (PostgreSQL for prod, InMemory for tests).
 * Aligned with Module 1 rate limiting strategy.
 */

import type { Pool } from 'pg';
import { Logger } from '../utils/Logger';

export interface RateLimiterConfig {
  windowMs: number;
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimiterConfig = {
  windowMs: 3600000, // 1 hour
};

export interface RateLimiterStorage {
  getLastRequestTime(key: string): Promise<Date | null>;
  setLastRequestTime(key: string, time: Date): Promise<void>;
}

/** PostgreSQL-backed storage for rate limit state */
export class PgRateLimiterStorage implements RateLimiterStorage {
  constructor(private pool: Pool) {}

  async getLastRequestTime(key: string): Promise<Date | null> {
    const result = await this.pool.query(
      'SELECT last_request_time FROM rate_limits WHERE key = $1',
      [key],
    );
    if (result.rows.length === 0) return null;
    return new Date(result.rows[0].last_request_time);
  }

  async setLastRequestTime(key: string, time: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO rate_limits (key, last_request_time)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET last_request_time = $2`,
      [key, time],
    );
  }
}

/** In-memory storage for rate limit state (useful for testing) */
export class InMemoryRateLimiterStorage implements RateLimiterStorage {
  private store = new Map<string, Date>();

  async getLastRequestTime(key: string): Promise<Date | null> {
    return this.store.get(key) ?? null;
  }

  async setLastRequestTime(key: string, time: Date): Promise<void> {
    this.store.set(key, time);
  }
}

export class RateLimiter {
  private config: RateLimiterConfig;
  private storage: RateLimiterStorage;
  private logger: Logger;

  constructor(
    config: Partial<RateLimiterConfig>,
    storage: RateLimiterStorage,
    logger: Logger,
  ) {
    this.config = { ...DEFAULT_RATE_LIMIT_CONFIG, ...config };
    this.storage = storage;
    this.logger = logger;
  }

  /** Check if a request is allowed for the given key */
  async isAllowed(key: string): Promise<boolean> {
    const lastRequest = await this.storage.getLastRequestTime(key);
    if (!lastRequest) return true;

    const elapsed = Date.now() - lastRequest.getTime();
    return elapsed >= this.config.windowMs;
  }

  /**
   * Check and consume a rate limit slot.
   * Returns true if allowed, throws RateLimitExceededError if not.
   */
  async consume(key: string): Promise<void> {
    const allowed = await this.isAllowed(key);
    if (!allowed) {
      const lastRequest = await this.storage.getLastRequestTime(key);
      const remainingMs = lastRequest
        ? this.config.windowMs - (Date.now() - lastRequest.getTime())
        : 0;

      this.logger.warn('Rate limit exceeded', {
        event: 'RATE_LIMIT_EXCEEDED',
        key,
        windowMs: this.config.windowMs,
        remainingMs,
      });

      throw new RateLimitExceededError(key, remainingMs);
    }

    await this.storage.setLastRequestTime(key, new Date());
    this.logger.debug('Rate limit consumed', {
      event: 'RATE_LIMIT_CONSUMED',
      key,
    });
  }

  /** Get remaining time until next allowed request (0 if allowed now) */
  async getRemainingMs(key: string): Promise<number> {
    const lastRequest = await this.storage.getLastRequestTime(key);
    if (!lastRequest) return 0;

    const elapsed = Date.now() - lastRequest.getTime();
    return Math.max(0, this.config.windowMs - elapsed);
  }
}

export class RateLimitExceededError extends Error {
  public readonly key: string;
  public readonly remainingMs: number;

  constructor(key: string, remainingMs: number) {
    super(`Rate limit exceeded for key: ${key}. Retry after ${Math.ceil(remainingMs / 1000)}s`);
    this.name = 'RateLimitExceededError';
    this.key = key;
    this.remainingMs = remainingMs;
  }
}
