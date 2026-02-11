import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderFactory } from '../../src/providers/ProviderFactory';
import type { ProviderFactoryConfig } from '../../src/providers/ProviderFactory';
import { Logger } from '../../src/utils/Logger';
import { InMemoryCircuitBreakerStorage } from '../../src/utils/CircuitBreaker';
import type { AppConfig } from '../../src/config/environment';

// Mock axios for GoldskyProvider
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

// Mock ethers for AlchemyProvider - use a class so `new` works
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: class MockJsonRpcProvider {
      getBlockNumber = vi.fn().mockResolvedValue(99999);
      getBalance = vi.fn().mockResolvedValue(BigInt('500000000000000000'));
    },
  },
}));

import axios from 'axios';
const mockedAxios = vi.mocked(axios);

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

const defaultFactoryConfig: ProviderFactoryConfig = {
  goldsky: {
    endpoint: 'https://api.goldsky.com/graphql',
    timeoutMs: 5000,
  },
  alchemy: {
    rpcEndpoints: {
      sepolia: 'https://eth-sepolia.g.alchemy.com/v2/test',
      arbitrum: 'https://arb-sepolia.g.alchemy.com/v2/test',
    },
    timeoutMs: 10000,
  },
  circuitBreaker: {
    threshold: 3,
    cooldownMs: 60000,
  },
};

const defaultParams = {
  key: '0x' + 'ab'.repeat(32),
  chains: ['sepolia'],
  schemaHash: '0x' + 'cd'.repeat(32),
};

describe('ProviderFactory', () => {
  let logger: Logger;
  let storage: InMemoryCircuitBreakerStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createSilentLogger();
    storage = new InMemoryCircuitBreakerStorage();
  });

  describe('construction', () => {
    it('should create primary and fallback providers', () => {
      const factory = new ProviderFactory(defaultFactoryConfig, logger, storage);

      expect(factory.getPrimary()).toBeDefined();
      expect(factory.getFallback()).toBeDefined();
      expect(factory.getPrimary().name).toBe('Goldsky');
      expect(factory.getFallback().name).toBe('Alchemy');
    });

    it('should use InMemoryStorage by default when none provided', () => {
      const factory = new ProviderFactory(defaultFactoryConfig, logger);

      expect(factory.getPrimary()).toBeDefined();
      expect(factory.getFallback()).toBeDefined();
    });
  });

  describe('queryWithFallback', () => {
    it('should use primary provider (Goldsky) when it succeeds', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { data: { records: [{ value: '42' }] } },
      });

      const factory = new ProviderFactory(defaultFactoryConfig, logger, storage);
      const result = await factory.queryWithFallback(defaultParams);

      expect(result.metadata.provider).toBe('Goldsky');
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('should fall back to Alchemy when Goldsky fails', async () => {
      // Make Goldsky fail (all retries)
      mockedAxios.post.mockRejectedValue(new Error('Goldsky is down'));

      const factory = new ProviderFactory(defaultFactoryConfig, logger, storage);
      const result = await factory.queryWithFallback(defaultParams);

      expect(result.metadata.provider).toBe('Alchemy');
    });

    it('should fall back to Alchemy when Goldsky returns GraphQL errors', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { errors: [{ message: 'Schema not found' }] },
      });

      const factory = new ProviderFactory(defaultFactoryConfig, logger, storage);
      const result = await factory.queryWithFallback(defaultParams);

      expect(result.metadata.provider).toBe('Alchemy');
    });
  });

  describe('fromAppConfig', () => {
    it('should create factory from AppConfig', () => {
      const appConfig: AppConfig = {
        database: { host: 'localhost', port: 5432, database: 'test', user: 'test', password: 'test' },
        blockchain: {
          rpcEndpoints: { sepolia: 'https://rpc.sepolia.test', arbitrum: 'https://rpc.arbitrum.test' },
          contractAddresses: {
            oracleSepolia: '0x' + '00'.repeat(20),
            cacheArbitrum: '0x' + '00'.repeat(20),
            cacheBase: '0x' + '00'.repeat(20),
          },
          ccipRouters: { sepolia: '0x' + '00'.repeat(20) },
          chainSelectors: { sepolia: '123' },
        },
        apiKeys: {
          alchemy: 'test-alchemy-key',
          claude: 'test-claude-key',
          goldsky: 'https://goldsky.test/graphql',
          litProtocol: 'test-lit-key',
        },
        n8n: { host: 'localhost', port: 5678, protocol: 'http', webhookUrl: 'http://localhost:5678/webhook' },
        app: { environment: 'testnet', logLevel: 'info', nodeEnv: 'test', port: 3000 },
      };

      const factory = ProviderFactory.fromAppConfig(appConfig, logger, storage);

      expect(factory.getPrimary().name).toBe('Goldsky');
      expect(factory.getFallback().name).toBe('Alchemy');
    });
  });
});
