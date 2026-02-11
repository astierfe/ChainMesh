/**
 * CircuitBreaker.ts - Circuit Breaker pattern implementation
 *
 * States: CLOSED → OPEN → HALF_OPEN → CLOSED
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Fast-fail, no requests allowed until cooldown expires
 * - HALF_OPEN: Allow one probe request to test recovery
 *
 * State is persisted in PostgreSQL (circuit_breakers table).
 */

import type { Pool } from 'pg';
import { Logger } from './Logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  provider: string;
  threshold: number;
  cooldownMs: number;
}

export interface CircuitBreakerStorage {
  getState(provider: string): Promise<{
    state: CircuitState;
    failureCount: number;
    lastFailureTime: Date | null;
    lastSuccessTime: Date | null;
  }>;
  setState(
    provider: string,
    state: CircuitState,
    failureCount: number,
    lastFailureTime: Date | null,
    lastSuccessTime: Date | null,
  ): Promise<void>;
}

/** PostgreSQL-backed storage for circuit breaker state */
export class PgCircuitBreakerStorage implements CircuitBreakerStorage {
  constructor(private pool: Pool) {}

  async getState(provider: string): Promise<{
    state: CircuitState;
    failureCount: number;
    lastFailureTime: Date | null;
    lastSuccessTime: Date | null;
  }> {
    const result = await this.pool.query(
      'SELECT state, failure_count, last_failure_time, last_success_time FROM circuit_breakers WHERE provider = $1',
      [provider],
    );
    if (result.rows.length === 0) {
      return { state: 'CLOSED', failureCount: 0, lastFailureTime: null, lastSuccessTime: null };
    }
    const row = result.rows[0];
    return {
      state: row.state as CircuitState,
      failureCount: row.failure_count,
      lastFailureTime: row.last_failure_time ? new Date(row.last_failure_time) : null,
      lastSuccessTime: row.last_success_time ? new Date(row.last_success_time) : null,
    };
  }

  async setState(
    provider: string,
    state: CircuitState,
    failureCount: number,
    lastFailureTime: Date | null,
    lastSuccessTime: Date | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO circuit_breakers (provider, state, failure_count, last_failure_time, last_success_time)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider) DO UPDATE
       SET state = $2, failure_count = $3, last_failure_time = $4, last_success_time = $5`,
      [provider, state, failureCount, lastFailureTime, lastSuccessTime],
    );
  }
}

/** In-memory storage for circuit breaker state (useful for testing) */
export class InMemoryCircuitBreakerStorage implements CircuitBreakerStorage {
  private store = new Map<string, {
    state: CircuitState;
    failureCount: number;
    lastFailureTime: Date | null;
    lastSuccessTime: Date | null;
  }>();

  async getState(provider: string): Promise<{
    state: CircuitState;
    failureCount: number;
    lastFailureTime: Date | null;
    lastSuccessTime: Date | null;
  }> {
    return this.store.get(provider) ?? {
      state: 'CLOSED',
      failureCount: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
    };
  }

  async setState(
    provider: string,
    state: CircuitState,
    failureCount: number,
    lastFailureTime: Date | null,
    lastSuccessTime: Date | null,
  ): Promise<void> {
    this.store.set(provider, { state, failureCount, lastFailureTime, lastSuccessTime });
  }
}

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private storage: CircuitBreakerStorage;
  private logger: Logger;

  constructor(
    config: CircuitBreakerConfig,
    storage: CircuitBreakerStorage,
    logger: Logger,
  ) {
    this.config = config;
    this.storage = storage;
    this.logger = logger;
  }

  /** Execute a function through the circuit breaker */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const canProceed = await this.canExecute();
    if (!canProceed) {
      this.logger.warn('Circuit breaker OPEN, fast-failing', {
        event: 'CIRCUIT_BREAKER_OPEN',
        provider: this.config.provider,
      });
      throw new CircuitBreakerOpenError(this.config.provider);
    }

    try {
      const result = await fn();
      await this.recordSuccess();
      return result;
    } catch (error) {
      await this.recordFailure();
      throw error;
    }
  }

  /** Check if the circuit breaker allows requests */
  async canExecute(): Promise<boolean> {
    const { state, lastFailureTime } = await this.storage.getState(this.config.provider);

    if (state === 'CLOSED' || state === 'HALF_OPEN') {
      return true;
    }

    // OPEN: check if cooldown has elapsed
    if (lastFailureTime) {
      const elapsed = Date.now() - lastFailureTime.getTime();
      if (elapsed >= this.config.cooldownMs) {
        // Transition to HALF_OPEN
        const current = await this.storage.getState(this.config.provider);
        await this.storage.setState(
          this.config.provider,
          'HALF_OPEN',
          current.failureCount,
          current.lastFailureTime,
          current.lastSuccessTime,
        );
        this.logger.info('Circuit breaker transitioning to HALF_OPEN', {
          event: 'CIRCUIT_BREAKER_HALF_OPEN',
          provider: this.config.provider,
        });
        return true;
      }
    }

    return false;
  }

  /** Get the current state of the circuit breaker */
  async getState(): Promise<CircuitState> {
    const { state } = await this.storage.getState(this.config.provider);
    return state;
  }

  /** Reset the circuit breaker to CLOSED state */
  async reset(): Promise<void> {
    await this.storage.setState(this.config.provider, 'CLOSED', 0, null, null);
    this.logger.info('Circuit breaker reset', {
      event: 'CIRCUIT_BREAKER_RESET',
      provider: this.config.provider,
    });
  }

  private async recordSuccess(): Promise<void> {
    const current = await this.storage.getState(this.config.provider);

    if (current.state === 'HALF_OPEN') {
      // Recovery confirmed: transition to CLOSED
      await this.storage.setState(this.config.provider, 'CLOSED', 0, null, new Date());
      this.logger.info('Circuit breaker recovered, closing', {
        event: 'CIRCUIT_BREAKER_CLOSED',
        provider: this.config.provider,
      });
    } else {
      await this.storage.setState(
        this.config.provider,
        'CLOSED',
        0,
        current.lastFailureTime,
        new Date(),
      );
    }
  }

  private async recordFailure(): Promise<void> {
    const current = await this.storage.getState(this.config.provider);
    const newCount = current.failureCount + 1;
    const now = new Date();

    if (current.state === 'HALF_OPEN') {
      // Probe failed: go back to OPEN
      await this.storage.setState(this.config.provider, 'OPEN', newCount, now, current.lastSuccessTime);
      this.logger.warn('Circuit breaker probe failed, reopening', {
        event: 'CIRCUIT_BREAKER_REOPEN',
        provider: this.config.provider,
        failureCount: newCount,
      });
    } else if (newCount >= this.config.threshold) {
      // Threshold reached: open circuit
      await this.storage.setState(this.config.provider, 'OPEN', newCount, now, current.lastSuccessTime);
      this.logger.error('Circuit breaker threshold reached, opening', {
        event: 'CIRCUIT_BREAKER_TRIPPED',
        provider: this.config.provider,
        failureCount: newCount,
        threshold: this.config.threshold,
      });
    } else {
      // Increment failure count, stay CLOSED
      await this.storage.setState(this.config.provider, 'CLOSED', newCount, now, current.lastSuccessTime);
      this.logger.warn('Circuit breaker failure recorded', {
        event: 'CIRCUIT_BREAKER_FAILURE',
        provider: this.config.provider,
        failureCount: newCount,
        threshold: this.config.threshold,
      });
    }
  }
}

export class CircuitBreakerOpenError extends Error {
  public readonly provider: string;

  constructor(provider: string) {
    super(`Circuit breaker OPEN for provider: ${provider}`);
    this.name = 'CircuitBreakerOpenError';
    this.provider = provider;
  }
}
