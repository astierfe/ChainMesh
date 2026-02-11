import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { GoldskyProvider } from '../../src/providers/GoldskyProvider';
import type { GoldskyQueryParams } from '../../src/providers/GoldskyProvider';
import { Logger } from '../../src/utils/Logger';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  InMemoryCircuitBreakerStorage,
} from '../../src/utils/CircuitBreaker';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

const defaultConfig = {
  endpoint: 'https://api.goldsky.com/graphql',
  timeoutMs: 5000,
};

const defaultParams: GoldskyQueryParams = {
  key: '0x' + 'ab'.repeat(32),
  chains: ['sepolia', 'arbitrum'],
  schemaHash: '0x' + 'cd'.repeat(32),
};

describe('GoldskyProvider', () => {
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createSilentLogger();
  });

  describe('query success', () => {
    it('should return formatted DataProviderOutput on success', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: {
            records: [
              { key: defaultParams.key, value: '100', chain: 'sepolia', timestamp: '2025-01-01T00:00:00Z', blockNumber: 12345 },
            ],
          },
        },
      });

      const provider = new GoldskyProvider(defaultConfig, logger);
      const result = await provider.query(defaultParams);

      expect(result.data).toBeDefined();
      expect(result.metadata.provider).toBe('Goldsky');
      expect(result.metadata.chains).toEqual(defaultParams.chains);
      expect(result.metadata.timestamp).toBeDefined();
      expect(result.metadata.queryDuration).toBeGreaterThanOrEqual(0);
    });

    it('should call axios.post with correct endpoint and payload', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { data: { records: [] } },
      });

      const provider = new GoldskyProvider(defaultConfig, logger);
      await provider.query(defaultParams);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        defaultConfig.endpoint,
        expect.objectContaining({
          query: expect.any(String),
          variables: { key: defaultParams.key, chains: defaultParams.chains },
        }),
        expect.objectContaining({
          timeout: defaultConfig.timeoutMs,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('should return empty object when response data is null', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { data: null },
      });

      const provider = new GoldskyProvider(defaultConfig, logger);
      const result = await provider.query(defaultParams);

      expect(result.data).toEqual({});
    });
  });

  describe('GraphQL errors', () => {
    it('should throw on GraphQL errors in response', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          errors: [{ message: 'Field not found' }, { message: 'Invalid query' }],
        },
      });

      const provider = new GoldskyProvider(defaultConfig, logger);
      await expect(provider.query(defaultParams)).rejects.toThrow('GraphQL errors: Field not found; Invalid query');
    });
  });

  describe('network errors with retry', () => {
    it('should retry on timeout errors', async () => {
      mockedAxios.post
        .mockRejectedValueOnce(new Error('timeout of 5000ms exceeded'))
        .mockRejectedValueOnce(new Error('timeout of 5000ms exceeded'))
        .mockResolvedValueOnce({
          data: { data: { records: [] } },
        });

      const provider = new GoldskyProvider(defaultConfig, logger);
      const result = await provider.query(defaultParams);

      expect(result.data).toEqual({ records: [] });
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    });

    it('should throw after exhausting retries', async () => {
      const error = new Error('network error');
      mockedAxios.post.mockRejectedValue(error);

      const provider = new GoldskyProvider(defaultConfig, logger);
      await expect(provider.query(defaultParams)).rejects.toThrow('network error');
    });
  });

  describe('circuit breaker integration', () => {
    it('should fast-fail when circuit breaker is open', async () => {
      const storage = new InMemoryCircuitBreakerStorage();
      const cb = new CircuitBreaker(
        { provider: 'goldsky', threshold: 1, cooldownMs: 60000 },
        storage,
        logger,
      );

      // Trip the circuit breaker
      mockedAxios.post.mockRejectedValueOnce(new Error('timeout'));
      const provider = new GoldskyProvider(defaultConfig, logger, cb);

      await expect(provider.query(defaultParams)).rejects.toThrow();

      // Second call should fast-fail via circuit breaker
      await expect(provider.query(defaultParams)).rejects.toThrow(CircuitBreakerOpenError);
    });
  });

  describe('name', () => {
    it('should return Goldsky', () => {
      const provider = new GoldskyProvider(defaultConfig, logger);
      expect(provider.name).toBe('Goldsky');
    });
  });
});
