import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { ChainMeshSDK } from '../../src/ChainMeshSDK.js';
import { ConfigError, ContractError, ApiError } from '../../src/types.js';
import { ReputationAdapter } from '../../src/adapters/ReputationAdapter.js';
import { PriceAdapter } from '../../src/adapters/PriceAdapter.js';

const { mockContractGetData, mockContractRequestData } = vi.hoisted(() => ({
  mockContractGetData: vi.fn(),
  mockContractRequestData: vi.fn(),
}));

vi.mock('ethers', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');

  // Must use function() for constructor mock
  const MockJsonRpcProvider = vi.fn(function (this: any) {
    return this;
  });

  const MockContract = vi.fn(function (this: any) {
    this.getData = mockContractGetData;
    this.requestData = mockContractRequestData;
    this.interface = {
      parseLog: vi.fn(),
    };
    return this;
  });

  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      Contract: MockContract,
      JsonRpcProvider: MockJsonRpcProvider,
    },
  };
});

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

const validConfig = {
  chains: {
    arbitrum: {
      rpcUrl: 'https://arb-sepolia.example.com',
      cacheAddress: '0x5b79dfb8b0decb3c1515f43ff8d3f79a71369578',
    },
    base: {
      rpcUrl: 'https://base-sepolia.example.com',
      cacheAddress: '0x438ed11546012eedc724d606b5d81aa54190e8b7',
    },
  },
  oracle: {
    rpcUrl: 'https://sepolia.example.com',
    address: '0x0c0c22fef7ff7adceb84cbf56c7e25cd1a21776a',
  },
  apiGateway: {
    url: 'http://localhost:5678/webhook',
  },
  defaultChain: 'arbitrum',
};

describe('ChainMeshSDK', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create SDK with valid config', () => {
      const sdk = new ChainMeshSDK(validConfig);
      expect(sdk).toBeInstanceOf(ChainMeshSDK);
    });

    it('should expose adapter helpers', () => {
      const sdk = new ChainMeshSDK(validConfig);
      expect(sdk.adapters.reputation).toBeInstanceOf(ReputationAdapter);
      expect(sdk.adapters.price).toBeInstanceOf(PriceAdapter);
    });

    it('should expose convenience accessors', () => {
      const sdk = new ChainMeshSDK(validConfig);
      expect(sdk.reputation).toBeDefined();
      expect(sdk.reputation.get).toBeInstanceOf(Function);
      expect(sdk.reputation.request).toBeInstanceOf(Function);
      expect(sdk.price).toBeDefined();
      expect(sdk.price.get).toBeInstanceOf(Function);
      expect(sdk.price.request).toBeInstanceOf(Function);
    });

    it('should throw ConfigError for invalid config', () => {
      expect(() => new ChainMeshSDK({} as any)).toThrow(ConfigError);
    });

    it('should throw ConfigError for invalid chain RPC URL', () => {
      expect(
        () =>
          new ChainMeshSDK({
            chains: {
              test: { rpcUrl: 'not-a-url', cacheAddress: '0x' + '1'.repeat(40) },
            },
          }),
      ).toThrow(ConfigError);
    });

    it('should throw ConfigError for invalid cache address', () => {
      expect(
        () =>
          new ChainMeshSDK({
            chains: {
              test: { rpcUrl: 'https://rpc.example.com', cacheAddress: 'not-an-address' },
            },
          }),
      ).toThrow(ConfigError);
    });

    it('should throw ConfigError when defaultChain is not in chains', () => {
      expect(
        () =>
          new ChainMeshSDK({
            chains: {
              arbitrum: {
                rpcUrl: 'https://rpc.example.com',
                cacheAddress: '0x' + '1'.repeat(40),
              },
            },
            defaultChain: 'nonexistent',
          }),
      ).toThrow(ConfigError);
    });

    it('should accept config without oracle or apiGateway', () => {
      const sdk = new ChainMeshSDK({
        chains: {
          arbitrum: {
            rpcUrl: 'https://rpc.example.com',
            cacheAddress: '0x' + '1'.repeat(40),
          },
        },
      });
      expect(sdk).toBeInstanceOf(ChainMeshSDK);
    });
  });

  describe('getData', () => {
    it('should call GenericCache.getData and return result', async () => {
      mockContractGetData.mockResolvedValue(['0x1234', true, false]);

      const sdk = new ChainMeshSDK(validConfig);
      const key = '0x' + 'ab'.repeat(32);
      const result = await sdk.getData(key, 'arbitrum');

      expect(result.value).toBe('0x1234');
      expect(result.isFromCache).toBe(true);
      expect(result.needsUpdate).toBe(false);
    });

    it('should use defaultChain when no chain specified', async () => {
      mockContractGetData.mockResolvedValue(['0x', false, true]);

      const sdk = new ChainMeshSDK(validConfig);
      await sdk.getData('0x' + 'ab'.repeat(32));
      expect(mockContractGetData).toHaveBeenCalled();
    });

    it('should throw ContractError on contract failure', async () => {
      mockContractGetData.mockRejectedValue(new Error('call reverted'));

      const sdk = new ChainMeshSDK(validConfig);
      await expect(sdk.getData('0x' + 'ab'.repeat(32), 'arbitrum')).rejects.toThrow(
        ContractError,
      );
    });

    it('should throw ConfigError for unconfigured chain', async () => {
      const sdk = new ChainMeshSDK({
        chains: {
          arbitrum: {
            rpcUrl: 'https://rpc.example.com',
            cacheAddress: '0x' + '1'.repeat(40),
          },
        },
      });

      await expect(sdk.getData('0x' + 'ab'.repeat(32), 'nonexistent')).rejects.toThrow(
        ConfigError,
      );
    });
  });

  describe('query', () => {
    it('should call API Gateway and return result', async () => {
      const axios = (await import('axios')).default;
      const mockResponse = {
        data: {
          executionId: 'exec-123',
          status: 'success',
          result: {
            data: { score: 75 },
            analysis: { result: {}, confidence: 0.9, reasoning: 'test' },
          },
        },
      };
      vi.mocked(axios.post).mockResolvedValue(mockResponse);

      const sdk = new ChainMeshSDK(validConfig);
      const result = await sdk.query({
        key: '0x' + 'ab'.repeat(32),
        schemaHash: '0x' + 'cd'.repeat(32),
        chains: ['arbitrum'],
      });

      expect(result.status).toBe('success');
      expect(result.executionId).toBe('exec-123');
    });

    it('should throw ConfigError when apiGateway not configured', async () => {
      const sdk = new ChainMeshSDK({
        chains: {
          arbitrum: {
            rpcUrl: 'https://rpc.example.com',
            cacheAddress: '0x' + '1'.repeat(40),
          },
        },
      });

      await expect(
        sdk.query({
          key: '0x' + 'ab'.repeat(32),
          schemaHash: '0x' + 'cd'.repeat(32),
          chains: ['arbitrum'],
        }),
      ).rejects.toThrow(ConfigError);
    });

    it('should throw ApiError on HTTP error response', async () => {
      const axios = (await import('axios')).default;
      const axiosError = {
        response: { status: 429, data: { message: 'rate limited' } },
        isAxiosError: true,
      };
      vi.mocked(axios.post).mockRejectedValue(axiosError);
      vi.mocked(axios.isAxiosError).mockReturnValue(true);

      const sdk = new ChainMeshSDK(validConfig);
      await expect(
        sdk.query({
          key: '0x' + 'ab'.repeat(32),
          schemaHash: '0x' + 'cd'.repeat(32),
          chains: ['arbitrum'],
        }),
      ).rejects.toThrow(ApiError);
    });

    it('should throw ApiError on network failure', async () => {
      const axios = (await import('axios')).default;
      vi.mocked(axios.post).mockRejectedValue(new Error('ECONNREFUSED'));
      vi.mocked(axios.isAxiosError).mockReturnValue(false);

      const sdk = new ChainMeshSDK(validConfig);
      await expect(
        sdk.query({
          key: '0x' + 'ab'.repeat(32),
          schemaHash: '0x' + 'cd'.repeat(32),
          chains: ['arbitrum'],
        }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('getOracleData', () => {
    it('should call GenericOracle.getData and return result', async () => {
      mockContractGetData.mockResolvedValue([
        '0xdeadbeef',
        1700000000,
        '0x' + 'aa'.repeat(32),
        true,
      ]);

      const sdk = new ChainMeshSDK(validConfig);
      const result = await sdk.getOracleData('0x' + 'ab'.repeat(32));

      expect(result.value).toBe('0xdeadbeef');
      expect(result.timestamp).toBe(1700000000);
      expect(result.isValid).toBe(true);
    });

    it('should throw ConfigError when oracle not configured', async () => {
      const sdk = new ChainMeshSDK({
        chains: {
          arbitrum: {
            rpcUrl: 'https://rpc.example.com',
            cacheAddress: '0x' + '1'.repeat(40),
          },
        },
      });

      await expect(sdk.getOracleData('0x' + 'ab'.repeat(32))).rejects.toThrow(
        ConfigError,
      );
    });
  });

  describe('reputation convenience', () => {
    it('should get reputation using cache-first strategy', async () => {
      const reputationAdapter = new ReputationAdapter();
      const encoded = reputationAdapter.encode(85, ethers.ZeroHash);

      mockContractGetData.mockResolvedValue([encoded, true, false]);

      const sdk = new ChainMeshSDK(validConfig);
      const result = await sdk.reputation.get(
        '0x1234567890123456789012345678901234567890',
        'arbitrum',
      );

      expect(result.score).toBe(85);
      expect(result.isFromCache).toBe(true);
      expect(result.needsUpdate).toBe(false);
    });

    it('should return default on cache miss', async () => {
      mockContractGetData.mockResolvedValue(['0x', false, true]);

      const sdk = new ChainMeshSDK(validConfig);
      const result = await sdk.reputation.get(
        '0x1234567890123456789012345678901234567890',
        'arbitrum',
      );

      expect(result.score).toBe(60);
      expect(result.isFromCache).toBe(false);
      expect(result.needsUpdate).toBe(true);
    });
  });

  describe('price convenience', () => {
    it('should get price using cache-first strategy', async () => {
      const priceAdapter = new PriceAdapter();
      const encoded = priceAdapter.encode(250000000000n, 8);

      mockContractGetData.mockResolvedValue([encoded, true, false]);

      const sdk = new ChainMeshSDK(validConfig);
      const result = await sdk.price.get('ETH', 'arbitrum');

      expect(result.value).toBe(250000000000n);
      expect(result.decimals).toBe(8);
      expect(result.isFromCache).toBe(true);
    });

    it('should return default on cache miss', async () => {
      mockContractGetData.mockResolvedValue(['0x', false, true]);

      const sdk = new ChainMeshSDK(validConfig);
      const result = await sdk.price.get('ETH', 'arbitrum');

      expect(result.value).toBe(0n);
      expect(result.decimals).toBe(18);
      expect(result.needsUpdate).toBe(true);
    });
  });
});
