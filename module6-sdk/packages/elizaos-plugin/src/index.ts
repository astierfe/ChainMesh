import { ChainMeshSDK, type ChainMeshConfig } from '@chainmesh/sdk';
import type { Plugin } from './types.js';
import {
  createQueryDataAction,
  createCheckCacheAction,
  createRequestUpdateAction,
  createGetReputationAction,
  createGetPriceAction,
} from './actions.js';

export type { Plugin, Action, Memory, State, HandlerCallback } from './types.js';

/**
 * Create the ChainMesh ElizaOS plugin.
 *
 * Wraps the ChainMesh SDK into ElizaOS-compatible actions
 * that AI agents can invoke through natural language.
 */
export function createChainMeshPlugin(config: ChainMeshConfig): Plugin {
  const sdk = new ChainMeshSDK(config);

  return {
    name: 'chainmesh',
    description: 'ChainMesh cross-chain data access for AI agents',
    actions: [
      createQueryDataAction(sdk),
      createCheckCacheAction(sdk),
      createRequestUpdateAction(sdk),
      createGetReputationAction(sdk),
      createGetPriceAction(sdk),
    ],
  };
}

/**
 * Create the ChainMesh ElizaOS plugin from an existing SDK instance.
 */
export function createChainMeshPluginFromSDK(sdk: ChainMeshSDK): Plugin {
  return {
    name: 'chainmesh',
    description: 'ChainMesh cross-chain data access for AI agents',
    actions: [
      createQueryDataAction(sdk),
      createCheckCacheAction(sdk),
      createRequestUpdateAction(sdk),
      createGetReputationAction(sdk),
      createGetPriceAction(sdk),
    ],
  };
}
