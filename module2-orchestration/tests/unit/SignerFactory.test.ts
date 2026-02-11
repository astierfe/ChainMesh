import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignerFactory } from '../../src/signers/SignerFactory';
import type { SignerFactoryConfig, SignPayload } from '../../src/signers/SignerFactory';
import { Logger } from '../../src/utils/Logger';
import { InMemoryCircuitBreakerStorage } from '../../src/utils/CircuitBreaker';
import type { AppConfig } from '../../src/config/environment';

// Mock axios for LitSigner
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

// Mock ethers — need class for `new ethers.Wallet()` and AbiCoder for hashing
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const mockSignMessage = vi.fn();

vi.mock('ethers', () => ({
  ethers: {
    Wallet: class MockWallet {
      address = TEST_ADDRESS;
      signMessage = mockSignMessage;
    },
    AbiCoder: {
      defaultAbiCoder: () => ({
        encode: vi.fn().mockReturnValue('0x' + 'aa'.repeat(32)),
      }),
    },
    keccak256: vi.fn().mockReturnValue('0x' + 'bb'.repeat(32)),
    getBytes: vi.fn().mockReturnValue(new Uint8Array(32)),
  },
}));

import axios from 'axios';
const mockedAxios = vi.mocked(axios);

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

const validSignature = '0x' + 'ab'.repeat(65);

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const defaultConfig: SignerFactoryConfig = {
  lit: {
    pkpPublicKey: '0x04' + 'ff'.repeat(64),
    litActionEndpoint: 'https://serrano.litgateway.com/api/v1/execute',
    timeoutMs: 5000,
  },
  devWallet: {
    privateKey: TEST_PRIVATE_KEY,
  },
  environment: 'testnet',
  circuitBreaker: {
    threshold: 3,
    cooldownMs: 60000,
  },
};

const defaultPayload: SignPayload = {
  key: '0x' + 'aa'.repeat(32),
  value: '0x' + 'bb'.repeat(32),
  schemaHash: '0x' + 'cc'.repeat(32),
  timestamp: 1738234567,
};

describe('SignerFactory', () => {
  let logger: Logger;
  let storage: InMemoryCircuitBreakerStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSignMessage.mockResolvedValue(validSignature);
    logger = createSilentLogger();
    storage = new InMemoryCircuitBreakerStorage();
  });

  describe('construction', () => {
    it('should create primary (Lit) and fallback (DevWallet) signers for testnet', () => {
      const factory = new SignerFactory(defaultConfig, logger, storage);

      expect(factory.getPrimary()).toBeDefined();
      expect(factory.getPrimary()!.name).toBe('Lit');
      expect(factory.getFallback()).toBeDefined();
      expect(factory.getFallback()!.name).toBe('DevWallet');
    });

    it('should not create DevWallet fallback in production', () => {
      const prodConfig = { ...defaultConfig, environment: 'production' };
      const factory = new SignerFactory(prodConfig, logger, storage);

      expect(factory.getPrimary()).toBeDefined();
      expect(factory.getFallback()).toBeNull();
    });
  });

  describe('signWithFallback', () => {
    it('should use Lit Protocol when it succeeds', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { signature: validSignature },
      });

      const factory = new SignerFactory(defaultConfig, logger, storage);
      const result = await factory.signWithFallback(defaultPayload);

      expect(result.signature).toBe(validSignature);
      expect(result.pkpPublicKey).toBe(defaultConfig.lit.pkpPublicKey);
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('should fall back to DevWallet when Lit fails on testnet', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Lit Protocol unavailable'));

      const factory = new SignerFactory(defaultConfig, logger, storage);
      const result = await factory.signWithFallback(defaultPayload);

      expect(result.signature).toBe(validSignature);
      expect(result.pkpPublicKey).toBe(TEST_ADDRESS);
    });

    it('should throw when Lit fails in production (no fallback)', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Lit Protocol unavailable'));

      const prodConfig = { ...defaultConfig, environment: 'production' };
      const factory = new SignerFactory(prodConfig, logger, storage);

      await expect(factory.signWithFallback(defaultPayload)).rejects.toThrow('Lit Protocol unavailable');
    });
  });

  describe('fromAppConfig', () => {
    it('should create factory from AppConfig', () => {
      const appConfig: AppConfig = {
        database: { host: 'localhost', port: 5432, database: 'test', user: 'test', password: 'test' },
        blockchain: {
          rpcEndpoints: { sepolia: 'https://rpc.sepolia.test' },
          contractAddresses: {
            oracleSepolia: '0x' + '00'.repeat(20),
            cacheArbitrum: '0x' + '00'.repeat(20),
            cacheBase: '0x' + '00'.repeat(20),
          },
          ccipRouters: { sepolia: '0x' + '00'.repeat(20) },
          chainSelectors: { sepolia: '123' },
        },
        apiKeys: {
          alchemy: 'test-key',
          claude: 'test-key',
          goldsky: 'test-endpoint',
          litProtocol: '0x04' + 'ff'.repeat(64),
        },
        n8n: { host: 'localhost', port: 5678, protocol: 'http', webhookUrl: 'http://localhost:5678/webhook' },
        app: { environment: 'testnet', logLevel: 'info', nodeEnv: 'test', port: 3000 },
      };

      const factory = SignerFactory.fromAppConfig(appConfig, logger, TEST_PRIVATE_KEY, storage);

      expect(factory.getPrimary()!.name).toBe('Lit');
      expect(factory.getFallback()!.name).toBe('DevWallet');
    });
  });
});
