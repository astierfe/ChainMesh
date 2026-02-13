/**
 * Integration Tests: SDK ↔ Real Contracts on Anvil
 *
 * Tests 1-3 from Phase 1:
 * 1. SDK ↔ GenericCache (cache miss → default, cache hit after write)
 * 2. SDK ↔ GenericOracle (read data written by UPDATER)
 * 3. Adapter cross-validation (encode JS → write on-chain → read on-chain → decode JS)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { ChainMeshSDK } from '../../src/ChainMeshSDK.js';
import { ReputationAdapter } from '../../src/adapters/ReputationAdapter.js';
import { PriceAdapter } from '../../src/adapters/PriceAdapter.js';
import {
  setupAnvil,
  releaseAnvil,
  deliverCCIPResponse,
  ANVIL_RPC_URL,
  type DeployedContracts,
} from './anvil-setup.js';

let contracts: DeployedContracts;
let sdk: ChainMeshSDK;

beforeAll(async () => {
  contracts = await setupAnvil();

  sdk = new ChainMeshSDK({
    chains: {
      'local-anvil': {
        rpcUrl: ANVIL_RPC_URL,
        cacheAddress: contracts.cacheAddress,
      },
    },
    oracle: {
      rpcUrl: ANVIL_RPC_URL,
      address: contracts.oracleAddress,
    },
    defaultChain: 'local-anvil',
  });
}, 30_000);

afterAll(async () => {
  await releaseAnvil();
});

// ==============================================================
// Test 1: SDK ↔ GenericCache réel
// ==============================================================
describe('Test 1: SDK ↔ GenericCache', () => {
  const reputationAdapter = new ReputationAdapter();

  it('cache miss returns empty value and needsUpdate=true', async () => {
    const key = reputationAdapter.getKey('0x1234567890123456789012345678901234567890');
    const result = await sdk.getData(key);

    expect(result.isFromCache).toBe(false);
    expect(result.needsUpdate).toBe(true);
    // Cache miss: value is empty bytes (0x)
    expect(result.value).toBe('0x');
  });

  it('cache hit after CCIP delivery returns correct data', async () => {
    const walletAddress = '0xABCDEF0123456789ABCDEF0123456789ABCDEF01';
    const key = reputationAdapter.getKey(walletAddress);
    const score = 85;
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes('test-evidence'));

    // Encode reputation data
    const encodedValue = reputationAdapter.encode(score, evidenceHash);

    // Simulate CCIP response delivery (Oracle → Cache)
    const fakeMessageId = ethers.keccak256(ethers.toUtf8Bytes('msg-1'));
    const timestamp = Math.floor(Date.now() / 1000);
    await deliverCCIPResponse(
      contracts,
      fakeMessageId,
      key,
      encodedValue,
      timestamp,
      ReputationAdapter.SCHEMA_HASH,
    );

    // Now read via SDK — should be a cache hit
    const result = await sdk.getData(key);

    expect(result.isFromCache).toBe(true);
    expect(result.needsUpdate).toBe(false);

    // Decode and verify
    const decoded = reputationAdapter.decode(result.value);
    expect(decoded.score).toBe(85);
    expect(decoded.evidenceHash).toBe(evidenceHash);
  });
});

// ==============================================================
// Test 2: SDK ↔ GenericOracle réel
// ==============================================================
describe('Test 2: SDK ↔ GenericOracle', () => {
  it('reads data written by UPDATER_ROLE', async () => {
    const reputationAdapter = new ReputationAdapter();
    const walletAddress = '0x1111111111111111111111111111111111111111';
    const key = reputationAdapter.getKey(walletAddress);
    const score = 92;
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes('oracle-evidence'));
    const encodedValue = reputationAdapter.encode(score, evidenceHash);

    // Write data directly to Oracle (as UPDATER)
    await contracts.oracle.updateData(key, encodedValue, ReputationAdapter.SCHEMA_HASH);

    // Read via SDK
    const result = await sdk.getOracleData(key);

    expect(result.isValid).toBe(true);
    expect(result.schemaHash).toBe(ReputationAdapter.SCHEMA_HASH);
    expect(result.timestamp).toBeGreaterThan(0);

    // Decode value
    const decoded = reputationAdapter.decode(result.value);
    expect(decoded.score).toBe(92);
    expect(decoded.evidenceHash).toBe(evidenceHash);
  });

  it('returns isValid=false for non-existent key', async () => {
    const nonExistentKey = ethers.keccak256(ethers.toUtf8Bytes('does-not-exist'));
    const result = await sdk.getOracleData(nonExistentKey);

    expect(result.isValid).toBe(false);
    expect(result.timestamp).toBe(0);
  });
});

// ==============================================================
// Test 3: Adapter cross-validation (round-trip JS ↔ on-chain)
// ==============================================================
describe('Test 3: Adapter cross-validation', () => {
  describe('ReputationAdapter round-trip', () => {
    it('encode JS → write Oracle → read Oracle → decode JS', async () => {
      const adapter = new ReputationAdapter();
      const walletAddress = '0x2222222222222222222222222222222222222222';
      const key = adapter.getKey(walletAddress);

      // 1. Encode in TypeScript
      const originalScore = 73;
      const originalEvidence = ethers.keccak256(ethers.toUtf8Bytes('rep-evidence-x'));
      const encoded = adapter.encode(originalScore, originalEvidence);

      // 2. Write on-chain via Oracle
      await contracts.oracle.updateData(key, encoded, ReputationAdapter.SCHEMA_HASH);

      // 3. Read back via SDK
      const result = await sdk.getOracleData(key);

      // 4. Decode in TypeScript
      const decoded = adapter.decode(result.value);

      expect(decoded.score).toBe(originalScore);
      expect(decoded.evidenceHash).toBe(originalEvidence);
    });

    it('encode JS → deliver to Cache → read Cache → decode JS', async () => {
      const adapter = new ReputationAdapter();
      const walletAddress = '0x3333333333333333333333333333333333333333';
      const key = adapter.getKey(walletAddress);

      const originalScore = 44;
      const originalEvidence = ethers.keccak256(ethers.toUtf8Bytes('cache-evidence'));
      const encoded = adapter.encode(originalScore, originalEvidence);

      // Deliver via CCIP to Cache
      const msgId = ethers.keccak256(ethers.toUtf8Bytes('msg-round-trip'));
      await deliverCCIPResponse(
        contracts,
        msgId,
        key,
        encoded,
        Math.floor(Date.now() / 1000),
        ReputationAdapter.SCHEMA_HASH,
      );

      // Read via SDK
      const result = await sdk.getData(key);
      const decoded = adapter.decode(result.value);

      expect(decoded.score).toBe(originalScore);
      expect(decoded.evidenceHash).toBe(originalEvidence);
    });
  });

  describe('PriceAdapter round-trip', () => {
    it('encode JS → write Oracle → read Oracle → decode JS', async () => {
      const adapter = new PriceAdapter();
      const key = adapter.getKey('ETH');

      // 1. Encode in TypeScript
      const originalValue = 250000000000n; // $2500.00 with 8 decimals
      const originalDecimals = 8;
      const encoded = adapter.encode(originalValue, originalDecimals);

      // 2. Write on-chain
      await contracts.oracle.updateData(key, encoded, PriceAdapter.SCHEMA_HASH);

      // 3. Read back
      const result = await sdk.getOracleData(key);

      // 4. Decode
      const decoded = adapter.decode(result.value);

      expect(decoded.value).toBe(originalValue);
      expect(decoded.decimals).toBe(originalDecimals);
    });

    it('encode JS → deliver to Cache → read Cache → decode JS', async () => {
      const adapter = new PriceAdapter();
      const key = adapter.getKey('BTC');

      const originalValue = 6500000000000n; // $65000.00 with 8 decimals
      const originalDecimals = 8;
      const encoded = adapter.encode(originalValue, originalDecimals);

      const msgId = ethers.keccak256(ethers.toUtf8Bytes('msg-price-rt'));
      await deliverCCIPResponse(
        contracts,
        msgId,
        key,
        encoded,
        Math.floor(Date.now() / 1000),
        PriceAdapter.SCHEMA_HASH,
      );

      const result = await sdk.getData(key);
      const decoded = adapter.decode(result.value);

      expect(decoded.value).toBe(originalValue);
      expect(decoded.decimals).toBe(originalDecimals);
    });
  });
});
