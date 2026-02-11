import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetryPolicy, createRetryableError, DEFAULT_RETRY_CONFIG } from '../../src/utils/RetryPolicy';
import { CircuitBreaker, CircuitBreakerOpenError, InMemoryCircuitBreakerStorage } from '../../src/utils/CircuitBreaker';
import { Logger } from '../../src/utils/Logger';

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

describe('RetryPolicy', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createSilentLogger();
  });

  describe('successful execution', () => {
    it('should return result on first success', async () => {
      const policy = new RetryPolicy(logger);
      const result = await policy.execute(() => Promise.resolve(42));
      expect(result).toBe(42);
    });

    it('should succeed after transient failures', async () => {
      const policy = new RetryPolicy(logger, {
        initialDelayMs: 1,
        maxDelayMs: 5,
      });
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) throw createRetryableError('TIMEOUT', 'timed out');
        return 'success';
      };

      const result = await policy.execute(fn);
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });
  });

  describe('retry exhaustion', () => {
    it('should throw after max retries', async () => {
      const policy = new RetryPolicy(logger, {
        maxRetries: 2,
        initialDelayMs: 1,
        maxDelayMs: 5,
      });
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw createRetryableError('TIMEOUT', 'always fails');
      };

      await expect(policy.execute(fn)).rejects.toThrow('always fails');
      expect(attempts).toBe(3); // initial + 2 retries
    });
  });

  describe('non-retryable errors', () => {
    it('should not retry non-retryable errors', async () => {
      const policy = new RetryPolicy(logger, {
        maxRetries: 3,
        initialDelayMs: 1,
      });
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw createRetryableError('VALIDATION_ERROR', 'bad input');
      };

      await expect(policy.execute(fn)).rejects.toThrow('bad input');
      expect(attempts).toBe(1); // No retry
    });
  });

  describe('isRetryable', () => {
    it('should recognize typed retryable errors', () => {
      const policy = new RetryPolicy(logger);
      expect(policy.isRetryable(createRetryableError('TIMEOUT', 'x'))).toBe(true);
      expect(policy.isRetryable(createRetryableError('NETWORK_ERROR', 'x'))).toBe(true);
      expect(policy.isRetryable(createRetryableError('RATE_LIMIT', 'x'))).toBe(true);
      expect(policy.isRetryable(createRetryableError('SERVICE_UNAVAILABLE', 'x'))).toBe(true);
    });

    it('should recognize retryable errors by message heuristic', () => {
      const policy = new RetryPolicy(logger);
      expect(policy.isRetryable(new Error('Connection timeout'))).toBe(true);
      expect(policy.isRetryable(new Error('ECONNREFUSED'))).toBe(true);
      expect(policy.isRetryable(new Error('ECONNRESET'))).toBe(true);
      expect(policy.isRetryable(new Error('network error'))).toBe(true);
      expect(policy.isRetryable(new Error('503 Service Unavailable'))).toBe(true);
      expect(policy.isRetryable(new Error('429 Too Many Requests'))).toBe(true);
    });

    it('should reject non-retryable errors', () => {
      const policy = new RetryPolicy(logger);
      expect(policy.isRetryable(createRetryableError('VALIDATION_ERROR', 'x'))).toBe(false);
      expect(policy.isRetryable(new Error('Some random error'))).toBe(false);
    });
  });

  describe('calculateDelay', () => {
    it('should increase delay exponentially', () => {
      const policy = new RetryPolicy(logger, {
        initialDelayMs: 100,
        multiplier: 2,
        maxDelayMs: 10000,
      });

      // Due to jitter, we check ranges
      const d0 = policy.calculateDelay(0);
      const d1 = policy.calculateDelay(1);
      const d2 = policy.calculateDelay(2);

      // attempt 0: base=100, jitter range [50, 100]
      expect(d0).toBeGreaterThanOrEqual(50);
      expect(d0).toBeLessThanOrEqual(100);

      // attempt 1: base=200, jitter range [100, 200]
      expect(d1).toBeGreaterThanOrEqual(100);
      expect(d1).toBeLessThanOrEqual(200);

      // attempt 2: base=400, jitter range [200, 400]
      expect(d2).toBeGreaterThanOrEqual(200);
      expect(d2).toBeLessThanOrEqual(400);
    });

    it('should cap delay at maxDelayMs', () => {
      const policy = new RetryPolicy(logger, {
        initialDelayMs: 1000,
        multiplier: 10,
        maxDelayMs: 5000,
      });

      // attempt 3: base = 1000 * 10^3 = 1,000,000 → capped to 5000
      const delay = policy.calculateDelay(3);
      expect(delay).toBeLessThanOrEqual(5000);
    });
  });

  describe('circuit breaker integration', () => {
    it('should throw CircuitBreakerOpenError without retrying', async () => {
      const storage = new InMemoryCircuitBreakerStorage();
      const cb = new CircuitBreaker(
        { provider: 'test', threshold: 1, cooldownMs: 60000 },
        storage,
        logger,
      );

      // Trip the circuit breaker
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      const policy = new RetryPolicy(logger, { maxRetries: 3, initialDelayMs: 1 }, cb);

      await expect(
        policy.execute(() => Promise.resolve('should not reach')),
      ).rejects.toThrow(CircuitBreakerOpenError);
    });
  });

  describe('createRetryableError', () => {
    it('should create error with type field', () => {
      const err = createRetryableError('TIMEOUT', 'Connection timed out');
      expect(err.type).toBe('TIMEOUT');
      expect(err.message).toBe('Connection timed out');
      expect(err instanceof Error).toBe(true);
    });
  });
});
