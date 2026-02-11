/**
 * RetryPolicy.ts - Exponential backoff with jitter
 *
 * Features:
 * - Configurable max retries, initial delay, multiplier, max delay
 * - Jitter to prevent thundering herd
 * - Integration with CircuitBreaker (skips retry if circuit is open)
 * - Retryable error classification
 */

import { Logger } from './Logger';
import { CircuitBreaker, CircuitBreakerOpenError } from './CircuitBreaker';

export interface RetryPolicyConfig {
  maxRetries: number;
  initialDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
  retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryPolicyConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  multiplier: 2,
  maxDelayMs: 10000,
  retryableErrors: ['TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMIT', 'SERVICE_UNAVAILABLE'],
};

export class RetryPolicy {
  private config: RetryPolicyConfig;
  private logger: Logger;
  private circuitBreaker: CircuitBreaker | null;

  constructor(
    logger: Logger,
    config: Partial<RetryPolicyConfig> = {},
    circuitBreaker?: CircuitBreaker,
  ) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.logger = logger;
    this.circuitBreaker = circuitBreaker ?? null;
  }

  /** Execute a function with retry logic */
  async execute<T>(fn: () => Promise<T>, operationName?: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = this.circuitBreaker
          ? await this.circuitBreaker.execute(fn)
          : await fn();
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry if circuit breaker is open
        if (error instanceof CircuitBreakerOpenError) {
          throw error;
        }

        // Don't retry if not retryable or max retries reached
        if (!this.isRetryable(lastError) || attempt >= this.config.maxRetries) {
          break;
        }

        const delay = this.calculateDelay(attempt);
        this.logger.warn('Retrying operation', {
          event: 'RETRY_ATTEMPT',
          operation: operationName,
          attempt: attempt + 1,
          maxRetries: this.config.maxRetries,
          delayMs: delay,
          error: lastError.message,
        });

        await this.sleep(delay);
      }
    }

    this.logger.error('All retries exhausted', {
      event: 'RETRY_EXHAUSTED',
      operation: operationName,
      maxRetries: this.config.maxRetries,
      error: lastError?.message,
    });

    throw lastError;
  }

  /** Check if an error is retryable based on configuration */
  isRetryable(error: Error): boolean {
    const errorType = (error as RetryableError).type;
    if (errorType && this.config.retryableErrors.includes(errorType)) {
      return true;
    }
    // Heuristic: check message for common retryable patterns
    const message = error.message.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('network') ||
      message.includes('503') ||
      message.includes('429')
    );
  }

  /** Calculate delay with exponential backoff and jitter */
  calculateDelay(attempt: number): number {
    const baseDelay = this.config.initialDelayMs * Math.pow(this.config.multiplier, attempt);
    const capped = Math.min(baseDelay, this.config.maxDelayMs);
    // Add jitter: random between 50%-100% of computed delay
    const jitter = capped * (0.5 + Math.random() * 0.5);
    return Math.floor(jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Error with a typed `type` field for retry classification */
export interface RetryableError extends Error {
  type: string;
}

/** Create a typed error for use with RetryPolicy */
export function createRetryableError(type: string, message: string): RetryableError {
  const error = new Error(message) as RetryableError;
  error.type = type;
  return error;
}
