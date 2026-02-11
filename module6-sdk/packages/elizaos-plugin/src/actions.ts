import type { ChainMeshSDK } from '@chainmesh/sdk';
import type { Action, Memory } from './types.js';

/** Extract a bytes32 key from a user message. */
function extractKey(text: string): string | null {
  const match = text.match(/0x[a-fA-F0-9]{64}/);
  return match ? match[0] : null;
}

/** Extract a chain name from a user message. */
function extractChain(text: string): string | null {
  const chains = ['sepolia', 'arbitrum', 'base', 'optimism'];
  const lower = text.toLowerCase();
  return chains.find((c) => lower.includes(c)) ?? null;
}

/** Extract an Ethereum address from a user message. */
function extractAddress(text: string): string | null {
  const match = text.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : null;
}

/** Extract a symbol (uppercase word) from a user message. */
function extractSymbol(text: string): string | null {
  const match = text.match(/\b(ETH|BTC|USDC|USDT|DAI|LINK|AVAX|SOL|MATIC|ARB|OP)\b/i);
  return match ? match[1].toUpperCase() : null;
}

export function createQueryDataAction(sdk: ChainMeshSDK): Action {
  return {
    name: 'QUERY_DATA',
    description: 'Query ChainMesh for data by key on a specific chain via the API Gateway',
    examples: [
      ['query chainmesh for 0xabc...def on arbitrum'],
      ['fetch data 0xabc...def from base'],
    ],
    validate: async (message: Memory) => {
      const text = message.content.text;
      return extractKey(text) !== null;
    },
    handler: async (message, _state, callback) => {
      const text = message.content.text;
      const key = extractKey(text);
      if (!key) {
        await callback({ text: 'Could not find a valid bytes32 key in your message.' });
        return false;
      }

      const chain = extractChain(text);
      const chains = chain ? [chain] : ['arbitrum'];

      try {
        const result = await sdk.query({
          key,
          schemaHash: '0x' + '0'.repeat(64),
          chains,
          includeAnalysis: true,
        });

        await callback({
          text: `Query result (${result.status}): ${JSON.stringify(result.result?.data ?? result.error, null, 2)}`,
          data: result as unknown as Record<string, unknown>,
        });
        return true;
      } catch (error) {
        await callback({
          text: `Query failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        return false;
      }
    },
  };
}

export function createCheckCacheAction(sdk: ChainMeshSDK): Action {
  return {
    name: 'CHECK_CACHE',
    description: 'Check if a key is cached on a specific chain',
    examples: [
      ['check if 0xabc...def is cached on arbitrum'],
      ['is 0xabc...def in cache on base'],
    ],
    validate: async (message: Memory) => {
      const text = message.content.text;
      return extractKey(text) !== null;
    },
    handler: async (message, _state, callback) => {
      const text = message.content.text;
      const key = extractKey(text);
      if (!key) {
        await callback({ text: 'Could not find a valid bytes32 key in your message.' });
        return false;
      }

      const chain = extractChain(text) ?? undefined;

      try {
        const result = await sdk.getData(key, chain);
        const status = result.isFromCache
          ? result.needsUpdate ? 'cached but stale' : 'cached and fresh'
          : 'not cached';

        await callback({
          text: `Key ${key} is ${status} on ${chain ?? 'default chain'}.`,
          data: result as unknown as Record<string, unknown>,
        });
        return true;
      } catch (error) {
        await callback({
          text: `Cache check failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        return false;
      }
    },
  };
}

export function createRequestUpdateAction(sdk: ChainMeshSDK): Action {
  return {
    name: 'REQUEST_UPDATE',
    description: 'Request fresh data for a key via CCIP on a specific chain',
    examples: [
      ['request fresh data for 0xabc...def on arbitrum'],
      ['update 0xabc...def on base'],
    ],
    validate: async (message: Memory) => {
      const text = message.content.text;
      return extractKey(text) !== null;
    },
    handler: async (message, _state, callback) => {
      const text = message.content.text;
      const key = extractKey(text);
      if (!key) {
        await callback({ text: 'Could not find a valid bytes32 key in your message.' });
        return false;
      }

      const chain = extractChain(text) ?? undefined;

      try {
        const result = await sdk.requestData(
          key,
          '0x' + '0'.repeat(64),
          chain,
        );

        await callback({
          text: `Update requested. CCIP message ID: ${result.messageId}`,
          data: { messageId: result.messageId },
        });
        return true;
      } catch (error) {
        await callback({
          text: `Update request failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        return false;
      }
    },
  };
}

export function createGetReputationAction(sdk: ChainMeshSDK): Action {
  return {
    name: 'GET_REPUTATION',
    description: 'Get reputation score for a wallet address on a specific chain',
    examples: [
      ['get reputation for 0x1234...5678 on arbitrum'],
      ['check reputation of 0x1234...5678'],
    ],
    validate: async (message: Memory) => {
      const text = message.content.text;
      return extractAddress(text) !== null;
    },
    handler: async (message, _state, callback) => {
      const text = message.content.text;
      const address = extractAddress(text);
      if (!address) {
        await callback({ text: 'Could not find a valid Ethereum address in your message.' });
        return false;
      }

      const chain = extractChain(text) ?? undefined;

      try {
        const result = await sdk.reputation.get(address, chain);
        const freshness = result.isFromCache
          ? result.needsUpdate ? '(stale)' : '(fresh)'
          : '(default)';

        await callback({
          text: `Reputation for ${address}: score=${result.score}/100 ${freshness}`,
          data: {
            score: result.score,
            evidenceHash: result.evidenceHash,
            isFromCache: result.isFromCache,
            needsUpdate: result.needsUpdate,
          },
        });
        return true;
      } catch (error) {
        await callback({
          text: `Reputation query failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        return false;
      }
    },
  };
}

export function createGetPriceAction(sdk: ChainMeshSDK): Action {
  return {
    name: 'GET_PRICE',
    description: 'Get price of a token symbol on a specific chain',
    examples: [
      ['get price of ETH on arbitrum'],
      ['check ETH price on base'],
    ],
    validate: async (message: Memory) => {
      const text = message.content.text;
      return extractSymbol(text) !== null;
    },
    handler: async (message, _state, callback) => {
      const text = message.content.text;
      const symbol = extractSymbol(text);
      if (!symbol) {
        await callback({ text: 'Could not find a valid token symbol in your message.' });
        return false;
      }

      const chain = extractChain(text) ?? undefined;

      try {
        const result = await sdk.price.get(symbol, chain);
        const freshness = result.isFromCache
          ? result.needsUpdate ? '(stale)' : '(fresh)'
          : '(default)';

        await callback({
          text: `Price of ${symbol}: ${result.value.toString()} (${result.decimals} decimals) ${freshness}`,
          data: {
            value: result.value.toString(),
            decimals: result.decimals,
            isFromCache: result.isFromCache,
            needsUpdate: result.needsUpdate,
          },
        });
        return true;
      } catch (error) {
        await callback({
          text: `Price query failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        return false;
      }
    },
  };
}
