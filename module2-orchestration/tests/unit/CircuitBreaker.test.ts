import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  InMemoryCircuitBreakerStorage,
} from '../../src/utils/CircuitBreaker';
import { Logger } from '../../src/utils/Logger';

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

describe('CircuitBreaker', () => {
  let storage: InMemoryCircuitBreakerStorage;
  let logger: Logger;

  beforeEach(() => {
    storage = new InMemoryCircuitBreakerStorage();
    logger = createSilentLogger();
  });

  function createCB(
    provider = 'test_provider',
    threshold = 3,
    cooldownMs = 1000,
  ): CircuitBreaker {
    return new CircuitBreaker({ provider, threshold, cooldownMs }, storage, logger);
  }

  describe('initial state', () => {
    it('should start in CLOSED state', async () => {
      const cb = createCB();
      expect(await cb.getState()).toBe('CLOSED');
    });

    it('should allow execution in CLOSED state', async () => {
      const cb = createCB();
      const result = await cb.execute(() => Promise.resolve(42));
      expect(result).toBe(42);
    });
  });

  describe('failure tracking', () => {
    it('should remain CLOSED below threshold', async () => {
      const cb = createCB('p', 3);

      // 2 failures (below threshold of 3)
      for (let i = 0; i < 2; i++) {
        await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
      }

      expect(await cb.getState()).toBe('CLOSED');
    });

    it('should transition to OPEN when threshold is reached', async () => {
      const cb = createCB('p', 3);

      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
      }

      expect(await cb.getState()).toBe('OPEN');
    });

    it('should fast-fail when OPEN', async () => {
      const cb = createCB('p', 1, 60000);

      // Trip the circuit
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // Should fast-fail
      await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow(CircuitBreakerOpenError);
    });
  });

  describe('recovery (HALF_OPEN)', () => {
    it('should transition to HALF_OPEN after cooldown', async () => {
      const cb = createCB('p', 1, 50); // 50ms cooldown

      // Trip circuit
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(await cb.getState()).toBe('OPEN');

      // Wait for cooldown
      await new Promise((r) => setTimeout(r, 60));

      // canExecute should transition to HALF_OPEN
      expect(await cb.canExecute()).toBe(true);
      expect(await cb.getState()).toBe('HALF_OPEN');
    });

    it('should close circuit after successful probe', async () => {
      const cb = createCB('p', 1, 50);

      // Trip circuit
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // Wait for cooldown
      await new Promise((r) => setTimeout(r, 60));

      // Successful probe
      const result = await cb.execute(() => Promise.resolve('recovered'));
      expect(result).toBe('recovered');
      expect(await cb.getState()).toBe('CLOSED');
    });

    it('should reopen circuit if probe fails', async () => {
      const cb = createCB('p', 1, 50);

      // Trip circuit
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // Wait for cooldown
      await new Promise((r) => setTimeout(r, 60));

      // Failed probe
      await expect(cb.execute(() => Promise.reject(new Error('still failing')))).rejects.toThrow();
      expect(await cb.getState()).toBe('OPEN');
    });
  });

  describe('reset', () => {
    it('should reset to CLOSED state', async () => {
      const cb = createCB('p', 1);

      // Trip circuit
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(await cb.getState()).toBe('OPEN');

      // Reset
      await cb.reset();
      expect(await cb.getState()).toBe('CLOSED');

      // Should work again
      const result = await cb.execute(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
    });
  });

  describe('success resets failure count', () => {
    it('should reset failure count on success', async () => {
      const cb = createCB('p', 3);

      // 2 failures
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // 1 success resets count
      await cb.execute(() => Promise.resolve('ok'));

      // 2 more failures should not trip (count reset)
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      expect(await cb.getState()).toBe('CLOSED');
    });
  });

  describe('CircuitBreakerOpenError', () => {
    it('should include provider name', () => {
      const err = new CircuitBreakerOpenError('goldsky');
      expect(err.provider).toBe('goldsky');
      expect(err.name).toBe('CircuitBreakerOpenError');
      expect(err.message).toContain('goldsky');
    });
  });

  describe('InMemoryCircuitBreakerStorage', () => {
    it('should return defaults for unknown provider', async () => {
      const state = await storage.getState('unknown');
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(0);
      expect(state.lastFailureTime).toBeNull();
    });

    it('should persist state correctly', async () => {
      const now = new Date();
      await storage.setState('test', 'OPEN', 5, now, null);

      const state = await storage.getState('test');
      expect(state.state).toBe('OPEN');
      expect(state.failureCount).toBe(5);
      expect(state.lastFailureTime).toEqual(now);
    });
  });
});
