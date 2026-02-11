import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RateLimiter,
  InMemoryRateLimiterStorage,
  RateLimitExceededError,
  DEFAULT_RATE_LIMIT_CONFIG,
} from '../../src/orchestrator/RateLimiter';
import { Logger } from '../../src/utils/Logger';

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

describe('RateLimiter', () => {
  let storage: InMemoryRateLimiterStorage;
  let logger: Logger;

  beforeEach(() => {
    storage = new InMemoryRateLimiterStorage();
    logger = createSilentLogger();
  });

  describe('isAllowed', () => {
    it('should allow first request for a key', async () => {
      const limiter = new RateLimiter({}, storage, logger);
      const allowed = await limiter.isAllowed('0x' + 'aa'.repeat(32));
      expect(allowed).toBe(true);
    });

    it('should deny request within the rate limit window', async () => {
      const limiter = new RateLimiter({ windowMs: 60000 }, storage, logger);
      const key = '0x' + 'aa'.repeat(32);

      await storage.setLastRequestTime(key, new Date());
      const allowed = await limiter.isAllowed(key);
      expect(allowed).toBe(false);
    });

    it('should allow request after the window has elapsed', async () => {
      const limiter = new RateLimiter({ windowMs: 1000 }, storage, logger);
      const key = '0x' + 'aa'.repeat(32);

      await storage.setLastRequestTime(key, new Date(Date.now() - 2000));
      const allowed = await limiter.isAllowed(key);
      expect(allowed).toBe(true);
    });

    it('should track different keys independently', async () => {
      const limiter = new RateLimiter({ windowMs: 60000 }, storage, logger);
      const key1 = '0x' + 'aa'.repeat(32);
      const key2 = '0x' + 'bb'.repeat(32);

      await storage.setLastRequestTime(key1, new Date());
      expect(await limiter.isAllowed(key1)).toBe(false);
      expect(await limiter.isAllowed(key2)).toBe(true);
    });
  });

  describe('consume', () => {
    it('should consume and record the request time', async () => {
      const limiter = new RateLimiter({}, storage, logger);
      const key = '0x' + 'aa'.repeat(32);

      await limiter.consume(key);

      const lastTime = await storage.getLastRequestTime(key);
      expect(lastTime).toBeDefined();
      expect(lastTime!.getTime()).toBeGreaterThan(Date.now() - 1000);
    });

    it('should throw RateLimitExceededError on second request within window', async () => {
      const limiter = new RateLimiter({ windowMs: 60000 }, storage, logger);
      const key = '0x' + 'aa'.repeat(32);

      await limiter.consume(key);

      await expect(limiter.consume(key)).rejects.toThrow(RateLimitExceededError);
    });

    it('should include key and remainingMs in error', async () => {
      const limiter = new RateLimiter({ windowMs: 60000 }, storage, logger);
      const key = '0x' + 'aa'.repeat(32);

      await limiter.consume(key);

      try {
        await limiter.consume(key);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitExceededError);
        const rlError = error as RateLimitExceededError;
        expect(rlError.key).toBe(key);
        expect(rlError.remainingMs).toBeGreaterThan(0);
        expect(rlError.remainingMs).toBeLessThanOrEqual(60000);
      }
    });

    it('should allow request after window expiry', async () => {
      const limiter = new RateLimiter({ windowMs: 100 }, storage, logger);
      const key = '0x' + 'aa'.repeat(32);

      await limiter.consume(key);

      // Wait for window to expire
      await new Promise((r) => setTimeout(r, 150));

      // Should not throw
      await limiter.consume(key);
    });
  });

  describe('getRemainingMs', () => {
    it('should return 0 for unknown key', async () => {
      const limiter = new RateLimiter({}, storage, logger);
      const remaining = await limiter.getRemainingMs('0x' + 'aa'.repeat(32));
      expect(remaining).toBe(0);
    });

    it('should return remaining time within window', async () => {
      const limiter = new RateLimiter({ windowMs: 60000 }, storage, logger);
      const key = '0x' + 'aa'.repeat(32);

      await limiter.consume(key);
      const remaining = await limiter.getRemainingMs(key);

      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(60000);
    });

    it('should return 0 after window expiry', async () => {
      const limiter = new RateLimiter({ windowMs: 100 }, storage, logger);
      const key = '0x' + 'aa'.repeat(32);

      await limiter.consume(key);
      await new Promise((r) => setTimeout(r, 150));

      const remaining = await limiter.getRemainingMs(key);
      expect(remaining).toBe(0);
    });
  });

  describe('default config', () => {
    it('should use 1 hour window by default', () => {
      expect(DEFAULT_RATE_LIMIT_CONFIG.windowMs).toBe(3600000);
    });
  });

  describe('InMemoryRateLimiterStorage', () => {
    it('should return null for unknown key', async () => {
      const result = await storage.getLastRequestTime('unknown');
      expect(result).toBeNull();
    });

    it('should store and retrieve request time', async () => {
      const time = new Date('2026-02-08T10:00:00Z');
      await storage.setLastRequestTime('key1', time);

      const result = await storage.getLastRequestTime('key1');
      expect(result).toEqual(time);
    });

    it('should overwrite previous time', async () => {
      const time1 = new Date('2026-02-08T10:00:00Z');
      const time2 = new Date('2026-02-08T11:00:00Z');

      await storage.setLastRequestTime('key1', time1);
      await storage.setLastRequestTime('key1', time2);

      const result = await storage.getLastRequestTime('key1');
      expect(result).toEqual(time2);
    });
  });

  describe('RateLimitExceededError', () => {
    it('should have correct properties', () => {
      const error = new RateLimitExceededError('mykey', 5000);
      expect(error.name).toBe('RateLimitExceededError');
      expect(error.key).toBe('mykey');
      expect(error.remainingMs).toBe(5000);
      expect(error.message).toContain('mykey');
      expect(error.message).toContain('5s');
    });
  });
});
