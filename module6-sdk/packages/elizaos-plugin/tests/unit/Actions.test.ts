import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChainMeshPluginFromSDK } from '../../src/index.js';
import type { Memory, HandlerCallback } from '../../src/types.js';

// Create a mock SDK
function createMockSDK() {
  return {
    getData: vi.fn(),
    requestData: vi.fn(),
    query: vi.fn(),
    getOracleData: vi.fn(),
    adapters: {
      reputation: {
        schemaHash: '0x' + 'aa'.repeat(32),
        getKey: vi.fn().mockReturnValue('0x' + 'bb'.repeat(32)),
        encode: vi.fn(),
        decode: vi.fn(),
        getDefaultValue: vi.fn(),
      },
      price: {
        schemaHash: '0x' + 'cc'.repeat(32),
        getKey: vi.fn().mockReturnValue('0x' + 'dd'.repeat(32)),
        encode: vi.fn(),
        decode: vi.fn(),
        getDefaultValue: vi.fn(),
      },
    },
    reputation: {
      get: vi.fn(),
      request: vi.fn(),
    },
    price: {
      get: vi.fn(),
      request: vi.fn(),
    },
  } as any;
}

function createMessage(text: string): Memory {
  return { content: { text } };
}

describe('ElizaOS Plugin', () => {
  let mockSDK: ReturnType<typeof createMockSDK>;
  let callback: HandlerCallback;

  beforeEach(() => {
    mockSDK = createMockSDK();
    callback = vi.fn();
  });

  describe('plugin creation', () => {
    it('should create plugin with 5 actions', () => {
      const plugin = createChainMeshPluginFromSDK(mockSDK);
      expect(plugin.name).toBe('chainmesh');
      expect(plugin.actions).toHaveLength(5);
    });

    it('should have all expected action names', () => {
      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const names = plugin.actions.map((a) => a.name);
      expect(names).toContain('QUERY_DATA');
      expect(names).toContain('CHECK_CACHE');
      expect(names).toContain('REQUEST_UPDATE');
      expect(names).toContain('GET_REPUTATION');
      expect(names).toContain('GET_PRICE');
    });
  });

  describe('QUERY_DATA action', () => {
    it('should validate messages with bytes32 key', async () => {
      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'QUERY_DATA')!;

      const valid = createMessage('query chainmesh for 0x' + 'ab'.repeat(32) + ' on arbitrum');
      const invalid = createMessage('query chainmesh for something');

      expect(await action.validate(valid, {})).toBe(true);
      expect(await action.validate(invalid, {})).toBe(false);
    });

    it('should call sdk.query with extracted key and chain', async () => {
      mockSDK.query.mockResolvedValue({
        executionId: 'exec-1',
        status: 'success',
        result: { data: { score: 75 } },
      });

      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'QUERY_DATA')!;
      const message = createMessage('query 0x' + 'ab'.repeat(32) + ' on base');

      await action.handler(message, {}, callback);

      expect(mockSDK.query).toHaveBeenCalledWith(
        expect.objectContaining({
          key: '0x' + 'ab'.repeat(32),
          chains: ['base'],
        }),
      );
      expect(callback).toHaveBeenCalled();
    });

    it('should handle query errors gracefully', async () => {
      mockSDK.query.mockRejectedValue(new Error('API timeout'));

      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'QUERY_DATA')!;
      const message = createMessage('query 0x' + 'ab'.repeat(32) + ' on arbitrum');

      const result = await action.handler(message, {}, callback);

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Query failed'),
        }),
      );
    });
  });

  describe('CHECK_CACHE action', () => {
    it('should validate messages with bytes32 key', async () => {
      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'CHECK_CACHE')!;

      const valid = createMessage('check if 0x' + 'ab'.repeat(32) + ' is cached');
      expect(await action.validate(valid, {})).toBe(true);
    });

    it('should report cached fresh data', async () => {
      mockSDK.getData.mockResolvedValue({
        value: '0x1234',
        isFromCache: true,
        needsUpdate: false,
      });

      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'CHECK_CACHE')!;
      const message = createMessage('check 0x' + 'ab'.repeat(32) + ' on arbitrum');

      await action.handler(message, {}, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('cached and fresh'),
        }),
      );
    });

    it('should report stale cache', async () => {
      mockSDK.getData.mockResolvedValue({
        value: '0x1234',
        isFromCache: true,
        needsUpdate: true,
      });

      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'CHECK_CACHE')!;
      const message = createMessage('check 0x' + 'ab'.repeat(32) + ' on arbitrum');

      await action.handler(message, {}, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('cached but stale'),
        }),
      );
    });

    it('should report not cached', async () => {
      mockSDK.getData.mockResolvedValue({
        value: '0x',
        isFromCache: false,
        needsUpdate: true,
      });

      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'CHECK_CACHE')!;
      const message = createMessage('check 0x' + 'ab'.repeat(32) + ' on base');

      await action.handler(message, {}, callback);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('not cached'),
        }),
      );
    });
  });

  describe('GET_REPUTATION action', () => {
    it('should validate messages with Ethereum address', async () => {
      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'GET_REPUTATION')!;

      const valid = createMessage('get reputation for 0x' + '1'.repeat(40));
      const invalid = createMessage('get reputation for someone');

      expect(await action.validate(valid, {})).toBe(true);
      expect(await action.validate(invalid, {})).toBe(false);
    });

    it('should return reputation data', async () => {
      mockSDK.reputation.get.mockResolvedValue({
        score: 85,
        evidenceHash: '0x' + '0'.repeat(64),
        isFromCache: true,
        needsUpdate: false,
      });

      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'GET_REPUTATION')!;
      const message = createMessage('get reputation for 0x' + '1'.repeat(40) + ' on arbitrum');

      await action.handler(message, {}, callback);

      expect(mockSDK.reputation.get).toHaveBeenCalledWith(
        '0x' + '1'.repeat(40),
        'arbitrum',
      );
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('score=85'),
        }),
      );
    });
  });

  describe('GET_PRICE action', () => {
    it('should validate messages with token symbol', async () => {
      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'GET_PRICE')!;

      const valid = createMessage('get price of ETH on arbitrum');
      const invalid = createMessage('get price of something');

      expect(await action.validate(valid, {})).toBe(true);
      expect(await action.validate(invalid, {})).toBe(false);
    });

    it('should return price data', async () => {
      mockSDK.price.get.mockResolvedValue({
        value: 250000000000n,
        decimals: 8,
        isFromCache: true,
        needsUpdate: false,
      });

      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'GET_PRICE')!;
      const message = createMessage('get price of ETH on base');

      await action.handler(message, {}, callback);

      expect(mockSDK.price.get).toHaveBeenCalledWith('ETH', 'base');
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('250000000000'),
        }),
      );
    });

    it('should handle price query errors', async () => {
      mockSDK.price.get.mockRejectedValue(new Error('contract call failed'));

      const plugin = createChainMeshPluginFromSDK(mockSDK);
      const action = plugin.actions.find((a) => a.name === 'GET_PRICE')!;
      const message = createMessage('get price of BTC on arbitrum');

      const result = await action.handler(message, {}, callback);

      expect(result).toBe(false);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Price query failed'),
        }),
      );
    });
  });
});
