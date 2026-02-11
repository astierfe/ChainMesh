import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AlchemyProvider } from '../../src/providers/AlchemyProvider';
import type { AlchemyQueryParams } from '../../src/providers/AlchemyProvider';
import { Logger } from '../../src/utils/Logger';
import {
  CircuitBreaker,
  InMemoryCircuitBreakerStorage,
} from '../../src/utils/CircuitBreaker';

// Mock ethers - use a class so `new` works
const mockEthersProvider = {
  getBlockNumber: vi.fn(),
  getBalance: vi.fn(),
};

vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: class MockJsonRpcProvider {
      getBlockNumber = mockEthersProvider.getBlockNumber;
      getBalance = mockEthersProvider.getBalance;
    },
  },
}));

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

const defaultConfig = {
  rpcEndpoints: {
    sepolia: 'https://eth-sepolia.g.alchemy.com/v2/test',
    arbitrum: 'https://arb-sepolia.g.alchemy.com/v2/test',
  },
  timeoutMs: 10000,
};

const defaultParams: AlchemyQueryParams = {
  key: '0x' + 'ab'.repeat(32),
  chains: ['sepolia', 'arbitrum'],
  schemaHash: '0x' + 'cd'.repeat(32),
};

describe('AlchemyProvider', () => {
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEthersProvider.getBlockNumber.mockResolvedValue(12345);
    mockEthersProvider.getBalance.mockResolvedValue(BigInt('1000000000000000000'));
    logger = createSilentLogger();
  });

  describe('query success', () => {
    it('should return formatted DataProviderOutput for all chains', async () => {
      const provider = new AlchemyProvider(defaultConfig, logger);
      const result = await provider.query(defaultParams);

      expect(result.data).toBeDefined();
      expect(result.metadata.provider).toBe('Alchemy');
      expect(result.metadata.chains).toEqual(defaultParams.chains);
      expect(result.metadata.timestamp).toBeDefined();
      expect(result.metadata.queryDuration).toBeGreaterThanOrEqual(0);
    });

    it('should query each chain in parallel', async () => {
      const provider = new AlchemyProvider(defaultConfig, logger);
      const result = await provider.query(defaultParams);

      const data = result.data as { results: Record<string, unknown>[] };
      expect(data.results).toHaveLength(2);
    });

    it('should report full success rate when all chains succeed', async () => {
      const provider = new AlchemyProvider(defaultConfig, logger);
      const result = await provider.query(defaultParams);

      expect(result.metadata.successRate).toBe(1);
      expect(result.metadata.partialData).toBe(false);
    });
  });

  describe('partial failures', () => {
    it('should handle chains with no RPC endpoint configured', async () => {
      const provider = new AlchemyProvider(defaultConfig, logger);
      const params: AlchemyQueryParams = {
        ...defaultParams,
        chains: ['sepolia', 'unknown_chain'],
      };

      const result = await provider.query(params);

      expect(result.metadata.successRate).toBeLessThan(1);
      expect(result.metadata.partialData).toBe(true);
      expect(result.metadata.warnings).toBeDefined();
      expect(result.metadata.warnings!.length).toBeGreaterThan(0);
    });

    it('should include warning messages for failed chains', async () => {
      const provider = new AlchemyProvider(defaultConfig, logger);
      const params: AlchemyQueryParams = {
        ...defaultParams,
        chains: ['unknown_chain'],
      };

      const result = await provider.query(params);

      expect(result.metadata.warnings).toBeDefined();
      expect(result.metadata.warnings![0]).toContain('unknown_chain');
    });
  });

  describe('empty chains', () => {
    it('should handle empty chain list', async () => {
      const provider = new AlchemyProvider(defaultConfig, logger);
      const result = await provider.query({ ...defaultParams, chains: [] });

      const data = result.data as { results: Record<string, unknown>[] };
      expect(data.results).toHaveLength(0);
      expect(result.metadata.successRate).toBe(0);
    });
  });

  describe('aggregation', () => {
    it('should aggregate results with chainCount', async () => {
      const provider = new AlchemyProvider(defaultConfig, logger);
      const result = await provider.query(defaultParams);

      const data = result.data as { aggregated: { chainCount: number } };
      expect(data.aggregated.chainCount).toBe(2);
    });
  });

  describe('circuit breaker integration', () => {
    it('should fast-fail when circuit breaker is open', async () => {
      const storage = new InMemoryCircuitBreakerStorage();
      const cb = new CircuitBreaker(
        { provider: 'alchemy', threshold: 1, cooldownMs: 60000 },
        storage,
        logger,
      );

      // Trip the circuit breaker manually
      await storage.setState('alchemy', 'OPEN', 1, new Date(), null);

      const provider = new AlchemyProvider(defaultConfig, logger, cb);

      // All chains should fail with circuit breaker open
      const result = await provider.query(defaultParams);
      expect(result.metadata.successRate).toBe(0);
      expect(result.metadata.partialData).toBe(true);
    });
  });

  describe('name', () => {
    it('should return Alchemy', () => {
      const provider = new AlchemyProvider(defaultConfig, logger);
      expect(provider.name).toBe('Alchemy');
    });
  });
});
