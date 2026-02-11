/**
 * ProviderFactory.ts - Factory for creating data providers
 *
 * Selects primary provider (Goldsky) with fallback to Alchemy.
 * Manages circuit breakers and retry policies for each provider.
 */

import { Logger } from '../utils/Logger';
import {
  CircuitBreaker,
  InMemoryCircuitBreakerStorage,
  CircuitBreakerOpenError,
} from '../utils/CircuitBreaker';
import type { CircuitBreakerStorage } from '../utils/CircuitBreaker';
import { GoldskyProvider } from './GoldskyProvider';
import type { GoldskyQueryParams } from './GoldskyProvider';
import { AlchemyProvider } from './AlchemyProvider';
import type { AlchemyQueryParams } from './AlchemyProvider';
import type { DataProviderOutput } from '../validators/outputValidator';
import type { AppConfig } from '../config/environment';

export interface ProviderFactoryConfig {
  goldsky: {
    endpoint: string;
    timeoutMs: number;
  };
  alchemy: {
    rpcEndpoints: Record<string, string>;
    timeoutMs: number;
  };
  circuitBreaker: {
    threshold: number;
    cooldownMs: number;
  };
}

export interface DataProvider {
  query(params: GoldskyQueryParams | AlchemyQueryParams): Promise<DataProviderOutput>;
  name: string;
}

export class ProviderFactory {
  private logger: Logger;
  private config: ProviderFactoryConfig;
  private storage: CircuitBreakerStorage;
  private goldskyProvider: GoldskyProvider;
  private alchemyProvider: AlchemyProvider;

  constructor(
    config: ProviderFactoryConfig,
    logger: Logger,
    storage?: CircuitBreakerStorage,
  ) {
    this.config = config;
    this.logger = logger;
    this.storage = storage ?? new InMemoryCircuitBreakerStorage();

    const goldskyCB = new CircuitBreaker(
      {
        provider: 'goldsky',
        threshold: config.circuitBreaker.threshold,
        cooldownMs: config.circuitBreaker.cooldownMs,
      },
      this.storage,
      logger,
    );

    const alchemyCB = new CircuitBreaker(
      {
        provider: 'alchemy',
        threshold: config.circuitBreaker.threshold,
        cooldownMs: config.circuitBreaker.cooldownMs,
      },
      this.storage,
      logger,
    );

    this.goldskyProvider = new GoldskyProvider(
      config.goldsky,
      logger,
      goldskyCB,
    );

    this.alchemyProvider = new AlchemyProvider(
      config.alchemy,
      logger,
      alchemyCB,
    );
  }

  /** Get the primary provider (Goldsky) */
  getPrimary(): GoldskyProvider {
    return this.goldskyProvider;
  }

  /** Get the fallback provider (Alchemy) */
  getFallback(): AlchemyProvider {
    return this.alchemyProvider;
  }

  /**
   * Query with automatic fallback: Goldsky → Alchemy
   * If Goldsky fails (circuit open, timeout, error), falls back to Alchemy.
   */
  async queryWithFallback(params: GoldskyQueryParams): Promise<DataProviderOutput> {
    try {
      return await this.goldskyProvider.query(params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Primary provider failed, falling back to Alchemy', {
        event: 'PROVIDER_FALLBACK',
        primaryProvider: 'Goldsky',
        fallbackProvider: 'Alchemy',
        error: message,
      });

      return await this.alchemyProvider.query({
        ...params,
        contractAddresses: undefined,
      });
    }
  }

  /** Create a ProviderFactory from application config */
  static fromAppConfig(
    appConfig: AppConfig,
    logger: Logger,
    storage?: CircuitBreakerStorage,
  ): ProviderFactory {
    return new ProviderFactory(
      {
        goldsky: {
          endpoint: appConfig.apiKeys.goldsky,
          timeoutMs: 10000,
        },
        alchemy: {
          rpcEndpoints: appConfig.blockchain.rpcEndpoints,
          timeoutMs: 10000,
        },
        circuitBreaker: {
          threshold: 3,
          cooldownMs: 60000,
        },
      },
      logger,
      storage,
    );
  }
}
