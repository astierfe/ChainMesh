/**
 * AlchemyProvider.ts - Fallback data provider using Alchemy RPC/SDK
 *
 * Retrieves on-chain data via ethers.js and Alchemy endpoints.
 * Used as fallback when Goldsky is unavailable.
 */

import { ethers } from 'ethers';
import { Logger } from '../utils/Logger';
import { CircuitBreaker } from '../utils/CircuitBreaker';
import { RetryPolicy } from '../utils/RetryPolicy';
import type { DataProviderOutput } from '../validators/outputValidator';

export interface AlchemyProviderConfig {
  rpcEndpoints: Record<string, string>;
  timeoutMs: number;
}

export interface AlchemyQueryParams {
  key: string;
  chains: string[];
  schemaHash: string;
  contractAddresses?: Record<string, string>;
}

export class AlchemyProvider {
  private config: AlchemyProviderConfig;
  private logger: Logger;
  private retryPolicy: RetryPolicy;
  private providers: Map<string, ethers.JsonRpcProvider>;

  constructor(
    config: AlchemyProviderConfig,
    logger: Logger,
    circuitBreaker?: CircuitBreaker,
  ) {
    this.config = config;
    this.logger = logger;
    this.retryPolicy = new RetryPolicy(
      logger,
      { maxRetries: 2, initialDelayMs: 500, multiplier: 2, maxDelayMs: 5000 },
      circuitBreaker,
    );
    this.providers = new Map();
  }

  /** Query Alchemy for blockchain data across chains */
  async query(params: AlchemyQueryParams): Promise<DataProviderOutput> {
    const startTime = Date.now();

    this.logger.info('Querying Alchemy provider', {
      event: 'ALCHEMY_QUERY_START',
      key: params.key,
      chains: params.chains,
      schemaHash: params.schemaHash,
    });

    const results: Record<string, unknown>[] = [];
    const warnings: string[] = [];
    let successCount = 0;

    // Query each chain in parallel
    const chainResults = await Promise.allSettled(
      params.chains.map((chain) =>
        this.retryPolicy.execute(
          () => this.queryChain(chain, params),
          `alchemy_${chain}`,
        ),
      ),
    );

    for (let i = 0; i < chainResults.length; i++) {
      const result = chainResults[i];
      if (result.status === 'fulfilled') {
        results.push(result.value);
        successCount++;
      } else {
        warnings.push(
          `Chain ${params.chains[i]} failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
        this.logger.warn('Chain query failed', {
          event: 'ALCHEMY_CHAIN_FAILURE',
          chain: params.chains[i],
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }

    const duration = Date.now() - startTime;
    const successRate = params.chains.length > 0 ? successCount / params.chains.length : 0;

    this.logger.info('Alchemy query completed', {
      event: 'ALCHEMY_QUERY_COMPLETE',
      duration,
      successRate,
      successCount,
      totalChains: params.chains.length,
    });

    return {
      data: { results, aggregated: this.aggregateResults(results) },
      metadata: {
        chains: params.chains,
        timestamp: new Date().toISOString(),
        provider: 'Alchemy',
        queryDuration: duration,
        partialData: successRate < 1,
        successRate,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  }

  private async queryChain(
    chain: string,
    params: AlchemyQueryParams,
  ): Promise<Record<string, unknown>> {
    const provider = this.getOrCreateProvider(chain);
    if (!provider) {
      throw new Error(`No RPC endpoint configured for chain: ${chain}`);
    }

    // Generic on-chain data retrieval
    const blockNumber = await provider.getBlockNumber();
    const balance = await provider.getBalance(params.key.slice(0, 42).padEnd(42, '0'));

    return {
      chain,
      blockNumber,
      balance: balance.toString(),
      timestamp: new Date().toISOString(),
    };
  }

  private getOrCreateProvider(chain: string): ethers.JsonRpcProvider | null {
    if (this.providers.has(chain)) {
      return this.providers.get(chain)!;
    }
    const rpcUrl = this.config.rpcEndpoints[chain];
    if (!rpcUrl) return null;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    this.providers.set(chain, provider);
    return provider;
  }

  private aggregateResults(
    results: Record<string, unknown>[],
  ): Record<string, unknown> {
    return {
      chainCount: results.length,
      data: results,
    };
  }

  /** Get the provider name */
  get name(): string {
    return 'Alchemy';
  }
}
