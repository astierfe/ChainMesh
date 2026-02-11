/**
 * GoldskyProvider.ts - Primary data provider using Goldsky GraphQL API
 *
 * Queries multi-chain blockchain data via GraphQL.
 * Integrates with CircuitBreaker and RetryPolicy for resilience.
 */

import axios from 'axios';
import { Logger } from '../utils/Logger';
import { CircuitBreaker } from '../utils/CircuitBreaker';
import { RetryPolicy } from '../utils/RetryPolicy';
import type { DataProviderOutput } from '../validators/outputValidator';

export interface GoldskyProviderConfig {
  endpoint: string;
  timeoutMs: number;
}

export interface GoldskyQueryParams {
  key: string;
  chains: string[];
  schemaHash: string;
}

export class GoldskyProvider {
  private config: GoldskyProviderConfig;
  private logger: Logger;
  private retryPolicy: RetryPolicy;

  constructor(
    config: GoldskyProviderConfig,
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
  }

  /** Query Goldsky for blockchain data */
  async query(params: GoldskyQueryParams): Promise<DataProviderOutput> {
    const startTime = Date.now();

    this.logger.info('Querying Goldsky provider', {
      event: 'GOLDSKY_QUERY_START',
      key: params.key,
      chains: params.chains,
      schemaHash: params.schemaHash,
    });

    const result = await this.retryPolicy.execute(
      () => this.executeGraphQLQuery(params),
      'goldsky_query',
    );

    const duration = Date.now() - startTime;
    this.logger.info('Goldsky query completed', {
      event: 'GOLDSKY_QUERY_SUCCESS',
      duration,
      key: params.key,
    });

    return {
      data: result,
      metadata: {
        chains: params.chains,
        timestamp: new Date().toISOString(),
        provider: 'Goldsky',
        queryDuration: duration,
      },
    };
  }

  private async executeGraphQLQuery(
    params: GoldskyQueryParams,
  ): Promise<Record<string, unknown>> {
    const query = this.buildQuery(params);

    const response = await axios.post(
      this.config.endpoint,
      { query, variables: { key: params.key, chains: params.chains } },
      {
        timeout: this.config.timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    if (response.data.errors) {
      const errorMsg = response.data.errors
        .map((e: { message: string }) => e.message)
        .join('; ');
      throw new Error(`GraphQL errors: ${errorMsg}`);
    }

    return response.data.data ?? {};
  }

  /** Build a generic GraphQL query based on schemaHash */
  private buildQuery(params: GoldskyQueryParams): string {
    return `
      query GetData($key: String!, $chains: [String!]!) {
        records(where: { key: $key, chains: $chains }) {
          key
          value
          chain
          timestamp
          blockNumber
        }
      }
    `;
  }

  /** Get the provider name */
  get name(): string {
    return 'Goldsky';
  }
}
